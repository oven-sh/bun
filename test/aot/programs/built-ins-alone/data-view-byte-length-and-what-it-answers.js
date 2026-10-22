const subject = new DataView(new ArrayBuffer(16));
const result = subject.byteLength;
console.log(typeof result, result + 1);
