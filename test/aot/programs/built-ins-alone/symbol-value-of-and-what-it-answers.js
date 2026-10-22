const subject = Symbol.for("name");
const result = subject.valueOf();
console.log(typeof result, result.description);
