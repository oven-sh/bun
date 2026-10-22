const subject = new Bun.MD4();
const first = new DataView(new ArrayBuffer(16));
const result = subject.digest(first);
console.log(result === first, first instanceof DataView, first.byteLength, first.byteOffset);
