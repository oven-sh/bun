const subject = Buffer.from("banana and more text, 24");
const result = subject[Symbol.toStringTag];
console.log(typeof result, result.length, result);
