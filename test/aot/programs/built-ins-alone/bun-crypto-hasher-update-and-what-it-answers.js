const subject = new Bun.CryptoHasher("sha256");
const result = subject.update("banana", "-");
console.log(result === subject);
