const subject = Buffer.from("banana and more text, 24");
const result = subject.readUIntBE(0, 2);
console.log(typeof result, result + 1);
