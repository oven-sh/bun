const subject = Buffer.from("banana and more text, 24");
const first = new DataView(new ArrayBuffer(16));
const result = subject.equals(first);
console.log(typeof result, result);
