const subject = Buffer.from("banana and more text, 24");
const first = new DataView(new ArrayBuffer(16));
const result = subject.copy(first, 2.5, 3.5, 4.5);
console.log(typeof result, result + 1, first instanceof DataView, first.byteLength, first.byteOffset);
