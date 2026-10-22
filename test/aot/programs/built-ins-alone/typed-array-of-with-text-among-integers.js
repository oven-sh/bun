const result = Uint8Array.of("text", 1.5);
console.log(result instanceof Uint8Array, result.length, typeof result[0], result[0] + 1, 1 / result[0]);
console.log(typeof result[1], result[1] + 1);
