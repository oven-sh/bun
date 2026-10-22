const subject = Buffer.from("banana and more text, 24");
const result = subject.hexSlice("an", 2.5);
console.log(typeof result, result.length, result);
