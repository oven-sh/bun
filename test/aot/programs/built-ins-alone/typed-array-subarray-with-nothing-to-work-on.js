const subject = new Uint8Array(0);
const result = subject.subarray(1, 2);
console.log(result instanceof Uint8Array, result.length);
