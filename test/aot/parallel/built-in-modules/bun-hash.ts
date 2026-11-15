console.log(Bun.hash.crc32("abc"), new Bun.CryptoHasher("sha1").update("a").digest("hex").length);

export {};
