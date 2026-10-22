const subject = setImmediate(() => {});
const result = subject.ref(1.5, "an");
console.log(result === subject);
