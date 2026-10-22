const first = new Uint8Array(0);
const result = new Uint8ClampedArray(first);
console.log(result instanceof Uint8ClampedArray, result.length);
