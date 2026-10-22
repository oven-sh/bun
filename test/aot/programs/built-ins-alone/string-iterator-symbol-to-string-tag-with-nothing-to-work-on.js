const subject = ""[Symbol.iterator]();
const result = subject[Symbol.toStringTag];
console.log(typeof result, result.length, result);
