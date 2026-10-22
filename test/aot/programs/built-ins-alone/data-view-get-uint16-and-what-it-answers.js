const subject = new DataView(new ArrayBuffer(16));
const result = subject.getUint16(1, true);
console.log(typeof result, result + 1, 1 / result);
