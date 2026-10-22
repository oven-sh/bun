const subject = new SharedArrayBuffer(8, { maxByteLength: 16 });
const result = subject.grow(16);
console.log(typeof result, result === undefined, subject instanceof SharedArrayBuffer, subject.byteLength);
