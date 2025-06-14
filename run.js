const { SuiClient } = require('@mysten/sui.js/client');
const { Ed25519Keypair } = require('@mysten/sui.js/keypairs/ed25519');
const { decodeSuiPrivateKey } = require('@mysten/sui.js/cryptography');
const { TransactionBlock } = require('@mysten/sui.js/transactions');
require('dotenv').config();

// Konfigurasi
const SUI_NETWORK = 'https://fullnode.testnet.sui.io:443';
const PACKAGE_ID = '0x5f422eac8ed9d1c87b3d033915fdfde4355e945db190e85e07a480cf662bb13f';
const VRAM_TOKEN_TYPE = '0x785082b640fb4de6fa0804c3fbf80297c49c875d825db7cd56cd65b03902b48a::tram_token::TRAM_TOKEN';
const ONICHANN_TOKEN_TYPE = '0xd0cd0d784c3b62072a13e8ca819568517e2eeb8dd496133f0ce2936b3f10a3d1::onichann::ONICHANN';

// Shared Objects
const MARKET_OBJECT = '0x6d04acfc9739caddd31de51d47edb1475684b6d8385c4985170bd5a604a08cd6'; // Diperbarui
const POOL_OBJECT = '0xe1a66da5266dda9ac35e1877b728bc2056beb6c9172e2a85fd031eba1789f2c2';

// Fungsi untuk memproses private key
function getKeypair(privateKey) {
    try {
        if (privateKey.startsWith('suiprivkey')) {
            const { secretKey } = decodeSuiPrivateKey(privateKey);
            return Ed25519Keypair.fromSecretKey(secretKey);
        }

        if (privateKey.length === 64) {
            return Ed25519Keypair.fromSecretKey(Buffer.from(privateKey, 'hex'));
        }

        if (privateKey.startsWith('0x') && privateKey.length === 66) {
            return Ed25519Keypair.fromSecretKey(Buffer.from(privateKey.slice(2), 'hex'));
        }

        const buffer = Buffer.from(privateKey, 'base64');
        if (buffer.length === 32) {
            return Ed25519Keypair.fromSecretKey(buffer);
        }

        throw new Error('Format private key tidak dikenali');
    } catch (error) {
        throw new Error(`Gagal memproses private key: ${error.message}`);
    }
}

// Fungsi untuk mendapatkan keypair dari mnemonic
function getKeypairFromMnemonic(mnemonic) {
    try {
        return Ed25519Keypair.deriveKeypair(mnemonic);
    } catch (error) {
        throw new Error(`Gagal memproses mnemonic: ${error.message}`);
    }
}

// Fungsi untuk membeli token ONICHANN
async function buyOnichannToken(client, keypair, amountVram, minAmountOut, address, vramCoinIds) {
    const tx = new TransactionBlock();

    // Pilih koin VRAM utama
    const primaryCoin = tx.object(vramCoinIds[0]);

    // Gabungkan koin jika diperlukan
    if (vramCoinIds.length > 1) {
        const additionalCoins = vramCoinIds.slice(1).map(id => tx.object(id));
        tx.mergeCoins(primaryCoin, additionalCoins);
    }

    // Split koin VRAM
    const [splitCoin] = tx.splitCoins(primaryCoin, [
        tx.pure(amountVram.toString())
    ]);

    // Panggil fungsi buy
    tx.moveCall({
        target: `${PACKAGE_ID}::vram::buy`,
        typeArguments: [ONICHANN_TOKEN_TYPE, VRAM_TOKEN_TYPE], // Diperbarui
        arguments: [
            tx.object(MARKET_OBJECT),
            tx.object(POOL_OBJECT),
            splitCoin,
            tx.pure('18446744073709551615'), // Max u64
            tx.pure(minAmountOut.toString()),
            tx.pure(address)
        ]
    });

    // Set gas budget
    tx.setGasBudget(10000000);

    try {
        const result = await client.signAndExecuteTransactionBlock({
            transactionBlock: tx,
            signer: keypair,
            options: { showEffects: true }
        });

        console.log('✅ Pembelian ONICHANN berhasil!');
        console.log('Digest:', result.digest);
        console.log('Dibelanjakan:', (Number(amountVram) / 1e9).toFixed(4), 'VRAM');

        return result;
    } catch (error) {
        console.error('❌ Pembelian ONICHANN gagal:', error);
        return null;
    }
}

// Fungsi untuk menjual token ONICHANN
async function sellOnichannToken(client, keypair, amountOnichann, minAmountOut, onichannCoinIds) {
    const tx = new TransactionBlock();

    // Pilih koin ONICHANN utama
    const primaryCoin = tx.object(onichannCoinIds[0]);

    // Gabungkan koin jika diperlukan
    if (onichannCoinIds.length > 1) {
        const additionalCoins = onichannCoinIds.slice(1).map(id => tx.object(id));
        tx.mergeCoins(primaryCoin, additionalCoins);
    }

    // Split koin ONICHANN
    const [splitCoin] = tx.splitCoins(primaryCoin, [
        tx.pure(amountOnichann.toString())
    ]);

    // Panggil fungsi sell
    tx.moveCall({
        target: `${PACKAGE_ID}::vram::sell`,
        typeArguments: [ONICHANN_TOKEN_TYPE, VRAM_TOKEN_TYPE], // Diperbarui
        arguments: [
            tx.object(MARKET_OBJECT),
            tx.object(POOL_OBJECT),
            splitCoin,
            tx.pure(minAmountOut.toString())
        ]
    });

    // Set gas budget
    tx.setGasBudget(10000000);

    try {
        const result = await client.signAndExecuteTransactionBlock({
            transactionBlock: tx,
            signer: keypair,
            options: { showEffects: true }
        });

        console.log('✅ Penjualan ONICHANN berhasil!');
        console.log('Digest:', result.digest);
        console.log('Dijual:', amountOnichann.toString(), 'ONICHANN');

        return result;
    } catch (error) {
        console.error('❌ Penjualan ONICHANN gagal:', error);
        return null;
    }
}

// Fungsi untuk mendapatkan koin dengan saldo mencukupi
async function getCoinsForAmount(client, address, coinType, amount) {
    const coins = await client.getCoins({
        owner: address,
        coinType,
    });

    let remaining = BigInt(amount);
    const selectedCoins = [];

    // Urutkan koin dari yang terbesar
    const sortedCoins = [...coins.data].sort((a, b) => {
        const balanceA = BigInt(a.balance);
        const balanceB = BigInt(b.balance);
        return balanceA > balanceB ? -1 : balanceA < balanceB ? 1 : 0;
    });

    for (const coin of sortedCoins) {
        if (remaining <= 0n) break;

        const balance = BigInt(coin.balance);
        if (balance > 0n) {
            selectedCoins.push(coin.coinObjectId);
            remaining -= balance;
        }
    }

    if (remaining > 0n) {
        return null; // Saldo tidak mencukupi
    }

    return selectedCoins;
}

// Fungsi untuk menampilkan saldo
async function showBalances(client, address) {
    try {
        // Saldo VRAM
        const vramCoins = await client.getCoins({
            owner: address,
            coinType: VRAM_TOKEN_TYPE,
        });
        const vramBalance = vramCoins.data.reduce((sum, coin) => sum + BigInt(coin.balance), 0n);

        // Saldo ONICHANN
        const onichannCoins = await client.getCoins({
            owner: address,
            coinType: ONICHANN_TOKEN_TYPE, // Diperbarui
        });
        const onichannBalance = onichannCoins.data.reduce((sum, coin) => sum + BigInt(coin.balance), 0n);

        console.log('\n📊 Saldo Saat Ini:');
        console.log(`- VRAM: ${(Number(vramBalance) / 1e9).toFixed(4)} (${vramCoins.data.length} koin)`);
        console.log(`- ONICHANN: ${onichannBalance.toString()} (${onichannCoins.data.length} koin)`); // Diperbarui

        return {
            vram: vramBalance,
            onichann: onichannBalance, // Diperbarui
            vramCoins: vramCoins.data,
            onichannCoins: onichannCoins.data // Diperbarui
        };
    } catch (error) {
        console.error('Gagal mendapatkan saldo:', error);
        return { vram: 0n, onichann: 0n, vramCoins: [], onichannCoins: [] }; // Diperbarui
    }
}

// Fungsi untuk menunda eksekusi
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Fungsi untuk menghasilkan nilai acak dalam rentang
function randomPercentage(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Fungsi untuk menghitung jumlah berdasarkan persentase
function calculatePercentageAmount(balance, percentage) {
    const percentageBigInt = BigInt(percentage);
    return (balance * percentageBigInt) / 100n;
}

// Main function
async function main() {
    try {
        // Setup Sui Client
        const client = new SuiClient({ url: SUI_NETWORK });

        // Load kredensial
        const credentials = process.env.CREDENTIALS;
        if (!credentials) {
            throw new Error('CREDENTIALS not found in .env file');
        }

        // Inisialisasi keypair
        let keypair;
        try {
            keypair = getKeypair(credentials);
            console.log('🔑 Menggunakan private key');
        } catch {
            keypair = getKeypairFromMnemonic(credentials);
            console.log('🔑 Menggunakan mnemonic phrase');
        }

        // Dapatkan address
        const address = keypair.getPublicKey().toSuiAddress();
        console.log('👤 Address:', address);

        // Loop tak terbatas untuk buy/sell
        let transactionCount = 0;
        const MIN_VRAM_BALANCE = 1000000000; // 2 VRAM minimal

        while (true) {
            transactionCount++;
            console.log(`\n🔄 Transaksi #${transactionCount} dimulai...`);

            // Dapatkan saldo saat ini
            const balances = await showBalances(client, address);

            // Cek saldo VRAM minimal
            if (balances.vram < MIN_VRAM_BALANCE) {
                console.log('⚠️ Saldo VRAM tidak mencukupi, hentikan trading');
                break;
            }

            // Pilih aksi secara acak: buy atau sell
            const action = Math.random() > 0.5 ? 'buy' : 'sell';

            try {
                if (action === 'buy') {
                    // Hitung persentase pembelian (6-17%)
                    const percentage = randomPercentage(6, 56);
                    const amountVram = calculatePercentageAmount(balances.vram, percentage);

                    // Validasi jumlah pembelian
                    if (amountVram <= 0n) {
                        console.log('⏭️ Jumlah pembelian tidak valid, lewati');
                        continue;
                    }

                    // Dapatkan koin VRAM yang diperlukan
                    const vramCoinIds = await getCoinsForAmount(client, address, VRAM_TOKEN_TYPE, amountVram.toString());

                    if (!vramCoinIds || vramCoinIds.length === 0) {
                        console.log('⏭️ Tidak ada koin VRAM yang cukup, lewati pembelian');
                    } else {
                        console.log(`🔵 Membeli ONICHANN dengan ${vramCoinIds.length} koin VRAM`);
                        console.log(`💸 Jumlah: ${Number(amountVram)/1e9} VRAM (${percentage}% dari saldo)`);
                        // Min amount out = 0 (terima berapapun)
                        await buyOnichannToken(client, keypair, amountVram, 0n, address, vramCoinIds);
                    }

                } else { // sell
                    // Jika tidak ada ONICHANN, lewati
                    if (balances.onichann <= 0n) {
                        console.log('⏭️ Saldo ONICHANN kosong, lewati penjualan');
                        continue;
                    }

                    // Hitung persentase penjualan (6-17%)
                    const percentage = randomPercentage(3, 27);
                    let amountOnichann = calculatePercentageAmount(balances.onichann, percentage);

                    // Pastikan minimal 1 token
                    if (amountOnichann <= 0n) amountOnichann = 1n;

                    // Dapatkan koin ONICHANN yang diperlukan
                    const onichannCoinIds = await getCoinsForAmount(client, address, ONICHANN_TOKEN_TYPE, amountOnichann.toString());

                    if (!onichannCoinIds || onichannCoinIds.length === 0) {
                        console.log('⏭️ Tidak ada koin ONICHANN yang cukup, lewati penjualan');
                    } else {
                        console.log(`🔴 Menjual dengan ${onichannCoinIds.length} koin ONICHANN`);
                        console.log(`💸 Jumlah: ${amountOnichann} ONICHANN (${percentage}% dari saldo)`);
                        // Min amount out = 0 (terima berapapun)
                        await sellOnichannToken(client, keypair, amountOnichann, 0n, onichannCoinIds);
                    }
                }
            } catch (error) {
                console.error('❌ Kesalahan dalam eksekusi transaksi:', error);
            }

            // Delay 7-10 detik sebelum transaksi berikutnya
            const delayTime = Math.floor(Math.random() * 1000) + 3000;
            console.log(`⏳ Menunggu ${(delayTime/1000).toFixed(2)} detik...`);
            await delay(delayTime);
        }

    } catch (error) {
        console.error('🚨 Error utama:', error);
    }
}

// Jalankan program
main();
