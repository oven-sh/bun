const subject = Buffer.from("banana and more text, 24");
const result = subject.readUInt16BE(1);
console.log(typeof result, result + 1);
