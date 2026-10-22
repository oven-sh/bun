const first = new ArrayBuffer(0);
const result = new Uint8ClampedArray(first, 0);
console.log(result instanceof Uint8ClampedArray, result.length);
