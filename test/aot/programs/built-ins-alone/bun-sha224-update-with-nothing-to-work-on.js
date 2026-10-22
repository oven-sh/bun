const subject = new Bun.SHA224();
const first = new ArrayBuffer(0);
const result = subject.update(first);
console.log(result === subject);
