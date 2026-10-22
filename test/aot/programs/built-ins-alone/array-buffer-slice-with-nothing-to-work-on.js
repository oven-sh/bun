const subject = new ArrayBuffer(0);
const result = subject.slice(1, 2);
console.log(result instanceof ArrayBuffer, result.byteLength);
