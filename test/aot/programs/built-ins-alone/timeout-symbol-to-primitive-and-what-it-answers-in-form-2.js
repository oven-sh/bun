const subject = setTimeout(() => {}, 0);
const result = subject[Symbol.toPrimitive]("an", "an");
console.log(typeof result);
