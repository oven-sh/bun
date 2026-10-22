const result = Uint8Array.fromBase64("YmFuYW5h");
console.log(result instanceof Uint8Array, result.length, typeof result[0], result[0] + 1);
console.log(typeof result[1], result[1] + 1);
