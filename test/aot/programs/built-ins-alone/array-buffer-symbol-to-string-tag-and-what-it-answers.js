const subject = new ArrayBuffer(8, { maxByteLength: 16 });
const result = subject[Symbol.toStringTag];
console.log(typeof result, result.length, result);
