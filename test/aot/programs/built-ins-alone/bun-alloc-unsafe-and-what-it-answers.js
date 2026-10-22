const result = Bun.allocUnsafe(1);
console.log(result instanceof Uint8Array, result.length, typeof result[0]);
