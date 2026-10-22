const subject = new DataView(new ArrayBuffer(16));
const result = subject.setBigUint64(1, 5n, true);
console.log(typeof result, result === undefined, subject instanceof DataView, subject.byteLength, subject.byteOffset);
