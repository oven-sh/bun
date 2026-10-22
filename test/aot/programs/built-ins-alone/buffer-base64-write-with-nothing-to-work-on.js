const subject = Buffer.alloc(0);
const result = subject.base64Write("an", "-", 3.5);
console.log(typeof result, result + 1, 1 / result);
