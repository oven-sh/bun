const subject = new Map().entries();
const result = subject[Symbol.toStringTag];
console.log(typeof result, result.length, result);
