const subject = new DataView(new ArrayBuffer(16));
const result = subject.buffer;
console.log(result instanceof ArrayBuffer, result.byteLength);
