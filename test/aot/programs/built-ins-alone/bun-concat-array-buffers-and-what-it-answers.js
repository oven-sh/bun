const result = Bun.concatArrayBuffers(null, 2.5, 3.5);
console.log(result instanceof ArrayBuffer, result.byteLength);
