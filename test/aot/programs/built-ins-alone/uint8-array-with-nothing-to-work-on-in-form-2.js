const first = new ArrayBuffer(0);
const result = new Uint8Array(first, 0);
console.log(result instanceof Uint8Array, result.length);
