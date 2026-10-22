const subject = setTimeout(() => {}, 0);
const result = subject[Symbol.toPrimitive](1.5, "an");
console.log(typeof result);
