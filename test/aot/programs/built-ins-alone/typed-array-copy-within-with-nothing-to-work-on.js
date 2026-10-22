const subject = new Uint8Array(0);
const result = subject.copyWithin(1, 2, 3);
console.log(result === subject);
