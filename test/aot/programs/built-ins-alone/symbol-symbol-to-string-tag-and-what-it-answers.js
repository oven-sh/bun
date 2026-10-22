const subject = Symbol.for("name");
const result = subject[Symbol.toStringTag];
console.log(typeof result, result.length, result);
