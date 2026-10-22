const first = new Uint8Array([1, 2, 3]);
const result = new Uint8ClampedArray(first);
console.log(result instanceof Uint8ClampedArray, result.length, typeof result[0], result[0] + 1);
console.log(typeof result[1], result[1] + 1);
