const subject = new SharedArrayBuffer(8, { maxByteLength: 16 });
const result = subject.byteLength;
console.log(typeof result, result + 1);
