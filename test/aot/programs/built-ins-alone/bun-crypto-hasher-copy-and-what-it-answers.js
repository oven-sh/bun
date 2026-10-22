const subject = new Bun.CryptoHasher("sha256");
const result = subject.copy();
console.log(typeof result, Object.keys(result).join());
