const subject = new SharedArrayBuffer(0);
const result = subject.slice(1, 2);
console.log(result instanceof SharedArrayBuffer, result.byteLength);
