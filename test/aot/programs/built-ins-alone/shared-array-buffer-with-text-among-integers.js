const result = new SharedArrayBuffer(1, "text");
console.log(result instanceof SharedArrayBuffer, result.byteLength);
