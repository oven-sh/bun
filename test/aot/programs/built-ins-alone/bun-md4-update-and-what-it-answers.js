const subject = new Bun.MD4();
const first = new ArrayBuffer(8, { maxByteLength: 16 });
const result = subject.update(first);
console.log(result === subject);
