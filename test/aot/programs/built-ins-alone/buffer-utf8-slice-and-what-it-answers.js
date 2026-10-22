const subject = Buffer.from("banana and more text, 24");
const result = subject.utf8Slice(1.5, 2.5);
console.log(typeof result, result.length, result);
