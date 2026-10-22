const subject = setImmediate(() => {});
const result = subject[Symbol.toPrimitive]("text", 1.5);
console.log(typeof result);
