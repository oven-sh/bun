const subject = new Bun.CryptoHasher("sha256");
const first = new ArrayBuffer(0);
const result = subject.update(first);
console.log(result === subject);
