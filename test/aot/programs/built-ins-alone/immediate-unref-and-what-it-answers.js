const subject = setImmediate(() => {});
const result = subject.unref(1.5, "an");
console.log(result === subject);
