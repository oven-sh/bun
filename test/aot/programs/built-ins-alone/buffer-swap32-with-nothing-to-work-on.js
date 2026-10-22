const subject = Buffer.alloc(0);
const result = subject.swap32();
console.log(result === subject);
