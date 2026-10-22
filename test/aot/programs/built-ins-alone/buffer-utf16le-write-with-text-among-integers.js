const subject = Buffer.from("banana and more text, 24");
const result = subject.utf16leWrite("an", "text", "text");
console.log(typeof result, result + 1, 1 / result);
