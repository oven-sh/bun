const first = new ArrayBuffer(0);
const result = Bun.hash.rapidhash(first, 2.5);
console.log(typeof result, result + 1n);
