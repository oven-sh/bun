const subject = setImmediate(() => {});
const result = subject.ref("text", 1.5);
console.log(result === subject);
