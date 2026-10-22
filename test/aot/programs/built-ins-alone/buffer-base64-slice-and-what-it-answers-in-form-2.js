const subject = Buffer.from("banana and more text, 24");
const result = subject.base64Slice("an", 2.5);
console.log(typeof result, result.length, result);
