const subject = Symbol.for("name");
const result = subject.toString();
console.log(typeof result, result.length, result);
