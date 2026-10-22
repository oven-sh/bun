const subject = setImmediate(() => {});
const result = subject[Symbol.toPrimitive]("an", "an");
console.log(typeof result);
