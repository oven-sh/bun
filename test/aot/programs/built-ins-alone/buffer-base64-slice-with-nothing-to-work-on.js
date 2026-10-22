const subject = Buffer.alloc(0);
const result = subject.base64Slice(1.5, 2.5);
console.log(typeof result, result.length, result);
