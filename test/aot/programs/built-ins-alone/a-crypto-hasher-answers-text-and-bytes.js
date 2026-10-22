const hasher = new Bun.CryptoHasher("sha256");
console.log(hasher.update("a") === hasher, hasher.digest("hex").length, new Bun.CryptoHasher("md5").update("a").digest().length + 1);
