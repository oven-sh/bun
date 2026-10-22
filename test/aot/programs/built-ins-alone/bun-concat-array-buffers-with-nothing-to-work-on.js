const first = [];
const result = Bun.concatArrayBuffers(first, 2.5, 3.5);
console.log(result instanceof Uint8Array, result.length);
