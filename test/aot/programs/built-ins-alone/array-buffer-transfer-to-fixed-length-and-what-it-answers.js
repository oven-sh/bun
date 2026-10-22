const subject = new ArrayBuffer(8, { maxByteLength: 16 });
const result = subject.transferToFixedLength(1);
console.log(result instanceof ArrayBuffer, result.byteLength, subject instanceof ArrayBuffer, subject.byteLength);
