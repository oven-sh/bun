const subject = Symbol.for("name");
const result = subject.description;
console.log(typeof result, result.length, result);
