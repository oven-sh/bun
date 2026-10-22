const result = new SharedArrayBuffer(1, null);
console.log(result instanceof SharedArrayBuffer, result.byteLength);
