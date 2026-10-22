const second = new DataView(new ArrayBuffer(16));
const result = Buffer.alloc(1.5, second, "x");
console.log(result instanceof Buffer, result.length, typeof result[0], result[0] + 1, 1 / result[0]);
