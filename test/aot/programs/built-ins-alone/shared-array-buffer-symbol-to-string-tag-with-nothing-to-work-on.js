const subject = new SharedArrayBuffer(0);
const result = subject[Symbol.toStringTag];
console.log(typeof result, result.length, result);
