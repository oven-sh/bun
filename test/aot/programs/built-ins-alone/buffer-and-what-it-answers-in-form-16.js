const first = new ArrayBuffer(8, { maxByteLength: 16 });
const result = new Buffer(first, 2.5, 3.5);
console.log(result instanceof Buffer, result.length, typeof result[0], result[0] + 1, 1 / result[0]);
console.log(typeof result[1], result[1] + 1, 1 / result[1]);
