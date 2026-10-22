const subject = new Bun.SHA256();
const first = new ArrayBuffer(8, { maxByteLength: 16 });
const result = subject.update(first);
console.log(result === subject);
