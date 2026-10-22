const subject = new Uint8Array(0);
const result = subject.buffer;
console.log(result instanceof ArrayBuffer, result.byteLength);
