const subject = Buffer.alloc(0);
const result = subject.asciiWrite("an", "-", 3.5);
console.log(typeof result, result + 1, 1 / result);
