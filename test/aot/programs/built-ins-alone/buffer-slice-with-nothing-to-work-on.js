const subject = Buffer.alloc(0);
const result = subject.slice(1.5, 2.5);
console.log(result instanceof Buffer, result.length);
