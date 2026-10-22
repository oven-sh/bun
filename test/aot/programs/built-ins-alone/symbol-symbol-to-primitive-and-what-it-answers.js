const subject = Symbol.for("name");
const result = subject[Symbol.toPrimitive]();
console.log(typeof result, result.description);
