const subject = new EventTarget();
const result = subject[Symbol.toStringTag];
console.log(typeof result, result.length, result);
