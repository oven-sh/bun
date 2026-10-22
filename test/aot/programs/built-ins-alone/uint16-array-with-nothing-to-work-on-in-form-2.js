const first = new ArrayBuffer(0);
const result = new Uint16Array(first, 0);
console.log(result instanceof Uint16Array, result.length);
