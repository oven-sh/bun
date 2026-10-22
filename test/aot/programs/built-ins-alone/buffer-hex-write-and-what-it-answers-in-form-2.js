const subject = Buffer.from("banana and more text, 24");
const result = subject.hexWrite("an", "-", 3.5);
console.log(typeof result, result + 1, 1 / result);
