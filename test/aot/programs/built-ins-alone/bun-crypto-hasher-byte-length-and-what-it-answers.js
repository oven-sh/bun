const subject = new Bun.CryptoHasher("sha256");
const result = subject.byteLength;
console.log(typeof result, result + 1);
