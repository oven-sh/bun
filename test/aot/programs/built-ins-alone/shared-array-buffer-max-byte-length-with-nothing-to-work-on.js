const subject = new SharedArrayBuffer(0);
const result = subject.maxByteLength;
console.log(typeof result, result + 1, 1 / result);
