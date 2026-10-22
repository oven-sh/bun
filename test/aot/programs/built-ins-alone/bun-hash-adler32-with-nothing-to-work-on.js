const first = new ArrayBuffer(0);
const result = Bun.hash.adler32(first);
console.log(typeof result, result + 1);
