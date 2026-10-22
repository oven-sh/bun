const subject = Buffer.alloc(0);
const result = subject.write("an", 0);
console.log(typeof result, result + 1, 1 / result);
