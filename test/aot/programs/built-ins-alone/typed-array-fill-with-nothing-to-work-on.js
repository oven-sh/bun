const subject = new Uint8Array(0);
const result = subject.fill(1.5, 2, 3);
console.log(result === subject);
