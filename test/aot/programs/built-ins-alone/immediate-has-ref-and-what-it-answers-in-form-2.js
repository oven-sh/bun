const subject = setImmediate(() => {});
const result = subject.hasRef("an", "an");
console.log(typeof result);
