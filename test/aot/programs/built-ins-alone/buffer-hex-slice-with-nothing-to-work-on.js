const subject = Buffer.alloc(0);
const result = subject.hexSlice(1.5, 2.5);
console.log(typeof result, result.length, result);
