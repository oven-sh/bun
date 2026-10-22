const first = new Uint8Array([1, 2, 3]);
const result = Buffer.from(first);
console.log(result instanceof Buffer, result.length, typeof result[0], result[0] + 1);
console.log(typeof result[1], result[1] + 1);
