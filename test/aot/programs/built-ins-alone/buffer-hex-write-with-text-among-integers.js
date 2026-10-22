const subject = Buffer.from("banana and more text, 24");
const result = subject.hexWrite("an", "text", "text");
console.log(typeof result, result + 1, 1 / result);
