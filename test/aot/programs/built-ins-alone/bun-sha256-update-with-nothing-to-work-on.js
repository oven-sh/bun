const subject = new Bun.SHA256();
const first = new ArrayBuffer(0);
const result = subject.update(first);
console.log(result === subject);
