const subject = new Bun.SHA1();
const first = new ArrayBuffer(0);
const result = subject.update(first);
console.log(result === subject);
