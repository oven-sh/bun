const subject = new DataView(new ArrayBuffer(16));
const result = subject.getInt8(1);
console.log(typeof result, result + 1, 1 / result);
