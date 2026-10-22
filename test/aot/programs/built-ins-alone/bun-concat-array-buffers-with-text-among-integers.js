const result = Bun.concatArrayBuffers(null, "text", "text");
console.log(result instanceof ArrayBuffer, result.byteLength);
