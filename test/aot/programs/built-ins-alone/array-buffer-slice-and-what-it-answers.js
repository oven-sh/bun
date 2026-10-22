const subject = new ArrayBuffer(8, { maxByteLength: 16 });
const result = subject.slice(1, 2);
console.log(result instanceof ArrayBuffer, result.byteLength);
