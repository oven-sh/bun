const subject = new ArrayBuffer(8, { maxByteLength: 16 });
const result = subject.resize(1);
console.log(typeof result, result === undefined, subject instanceof ArrayBuffer, subject.byteLength);
