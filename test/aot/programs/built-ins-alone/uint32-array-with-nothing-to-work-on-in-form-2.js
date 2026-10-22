const first = new ArrayBuffer(0);
const result = new Uint32Array(first, 0);
console.log(result instanceof Uint32Array, result.length);
