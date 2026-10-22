const subject = new URLSearchParams();
const result = subject[Symbol.toStringTag];
console.log(typeof result, result.length, result);
