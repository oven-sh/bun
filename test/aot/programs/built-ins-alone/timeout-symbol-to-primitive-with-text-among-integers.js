const subject = setTimeout(() => {}, 0);
const result = subject[Symbol.toPrimitive]("text", 1.5);
console.log(typeof result);
