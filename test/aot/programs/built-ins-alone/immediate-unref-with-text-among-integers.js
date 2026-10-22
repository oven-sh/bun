const subject = setImmediate(() => {});
const result = subject.unref("text", 1.5);
console.log(result === subject);
