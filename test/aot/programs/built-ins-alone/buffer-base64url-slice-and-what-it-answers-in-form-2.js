const subject = Buffer.from("banana and more text, 24");
const result = subject.base64urlSlice("an", 2.5);
console.log(typeof result, result.length, result);
