const subject = new Uint8Array([1, 2, 3]);
const result = subject[Symbol.toStringTag];
console.log(typeof result, result.length, result);
