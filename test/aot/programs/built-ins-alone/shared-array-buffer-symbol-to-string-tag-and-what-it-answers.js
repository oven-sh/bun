const subject = new SharedArrayBuffer(8, { maxByteLength: 16 });
const result = subject[Symbol.toStringTag];
console.log(typeof result, result.length, result);
