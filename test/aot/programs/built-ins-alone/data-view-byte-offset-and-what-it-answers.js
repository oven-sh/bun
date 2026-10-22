const subject = new DataView(new ArrayBuffer(16));
const result = subject.byteOffset;
console.log(typeof result, result + 1, 1 / result);
