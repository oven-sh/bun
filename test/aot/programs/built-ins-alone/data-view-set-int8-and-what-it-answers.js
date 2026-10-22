const subject = new DataView(new ArrayBuffer(16));
const result = subject.setInt8(1, 2.5);
console.log(typeof result, result === undefined, subject instanceof DataView, subject.byteLength, subject.byteOffset);
