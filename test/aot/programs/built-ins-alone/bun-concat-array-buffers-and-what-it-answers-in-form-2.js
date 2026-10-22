const result = Bun.concatArrayBuffers(null, "-", 3.5);
console.log(result instanceof ArrayBuffer, result.byteLength);
