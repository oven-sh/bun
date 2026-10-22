const subject = new Bun.SHA512_256();
const result = subject.digest(null);
console.log(result instanceof Uint8Array, result.length, typeof result[0], result[0] + 1);
console.log(typeof result[1], result[1] + 1);
