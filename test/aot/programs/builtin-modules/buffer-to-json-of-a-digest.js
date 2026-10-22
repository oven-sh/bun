// The digest of Bun.CryptoHasher is a Buffer that native code makes, and Buffer.prototype.toJSON is written in JavaScript. This program never names Buffer.
console.log(new Bun.CryptoHasher("sha1").update("a").digest().toJSON().data.length);
