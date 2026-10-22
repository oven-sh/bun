const subject = Buffer.from("banana and more text, 24");
const result = subject.asciiSlice("an", 2.5);
console.log(typeof result, result.length, result);
