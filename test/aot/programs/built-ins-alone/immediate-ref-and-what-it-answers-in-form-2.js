const subject = setImmediate(() => {});
const result = subject.ref("an", "an");
console.log(result === subject);
