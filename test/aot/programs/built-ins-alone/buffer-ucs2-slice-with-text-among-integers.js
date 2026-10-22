const subject = Buffer.from("banana and more text, 24");
const result = subject.ucs2Slice("text", "text");
console.log(typeof result, result.length, result);
