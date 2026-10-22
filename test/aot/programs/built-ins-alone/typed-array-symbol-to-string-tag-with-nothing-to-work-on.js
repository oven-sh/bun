const subject = new Uint8Array(0);
const result = subject[Symbol.toStringTag];
console.log(typeof result, result.length, result);
