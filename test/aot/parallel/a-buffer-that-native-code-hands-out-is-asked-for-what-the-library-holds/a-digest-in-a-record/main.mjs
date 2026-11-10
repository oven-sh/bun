console.log(JSON.stringify({ sum: Bun.CryptoHasher.hash("sha256", "a") }).slice(0, 30));
