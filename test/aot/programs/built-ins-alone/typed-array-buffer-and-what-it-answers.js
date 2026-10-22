const subject = new Uint8Array([1, 2, 3]);
const result = subject.buffer;
console.log(result instanceof ArrayBuffer, result.byteLength);
