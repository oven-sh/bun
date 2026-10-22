const subject = Buffer.from("banana and more text, 24");
const result = subject.slice(1.5, 2.5);
console.log(result instanceof Buffer, result.length, typeof result[0], result[0] + 1);
