const first = new ArrayBuffer(0);
const result = Bun.hash.cityHash32(first);
console.log(typeof result, result + 1);
