const first = new ArrayBuffer(0);
const result = Bun.hash.wyhash(first, 2.5);
console.log(typeof result, result + 1n);
