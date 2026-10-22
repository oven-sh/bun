const subject = new Bun.CryptoHasher("sha256");
const result = subject.algorithm;
console.log(typeof result, result.length, result);
