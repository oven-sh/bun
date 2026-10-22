const subject = "x".matchAll(/a/g);
const result = subject[Symbol.toStringTag];
console.log(typeof result, result.length, result);
