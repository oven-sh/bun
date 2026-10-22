const subject = new SharedArrayBuffer(0);
const result = subject.byteLength;
console.log(typeof result, result + 1, 1 / result);
