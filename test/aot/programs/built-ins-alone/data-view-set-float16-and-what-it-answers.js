const subject = new DataView(new ArrayBuffer(16));
const result = subject.setFloat16(1, 2.5, true);
console.log(typeof result, result === undefined, subject instanceof DataView, subject.byteLength, subject.byteOffset);
