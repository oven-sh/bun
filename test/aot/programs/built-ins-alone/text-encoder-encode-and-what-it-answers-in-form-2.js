const subject = new TextEncoder();
const result = subject.encode(1.5);
console.log(result instanceof Uint8Array, result.length, typeof result[0], result[0] + 1);
console.log(typeof result[1], result[1] + 1);
