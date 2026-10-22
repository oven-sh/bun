const subject = new Set().values();
const result = subject[Symbol.toStringTag];
console.log(typeof result, result.length, result);
