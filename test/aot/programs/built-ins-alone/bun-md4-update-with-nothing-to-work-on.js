const subject = new Bun.MD4();
const first = new ArrayBuffer(0);
const result = subject.update(first);
console.log(result === subject);
