const subject = new DataView(new ArrayBuffer(16));
const result = subject[Symbol.toStringTag];
console.log(typeof result, result.length, result);
