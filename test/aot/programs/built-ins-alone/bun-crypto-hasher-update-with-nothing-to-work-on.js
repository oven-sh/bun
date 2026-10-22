const subject = new Bun.CryptoHasher("sha256");
const result = subject.update("", "-");
console.log(result === subject);
