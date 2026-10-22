const subject = Buffer.from("banana and more text, 24");
const result = subject.readInt16(1);
console.log(typeof result, result + 1);
