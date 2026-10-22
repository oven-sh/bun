const subject = setImmediate(() => {});
const result = subject.unref("an", "an");
console.log(result === subject);
