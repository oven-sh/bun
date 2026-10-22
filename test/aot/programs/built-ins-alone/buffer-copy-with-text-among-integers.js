const subject = Buffer.from("banana and more text, 24");
const first = new DataView(new ArrayBuffer(16));
const result = subject.copy(first, "text", "text", "text");
console.log(typeof result, result + 1, 1 / result);
