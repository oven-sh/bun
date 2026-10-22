const first = new ArrayBuffer(0);
const result = Buffer.byteLength(first);
console.log(typeof result, result + 1, 1 / result);
