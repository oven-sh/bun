const result = new SharedArrayBuffer(1, "-");
console.log(result instanceof SharedArrayBuffer, result.byteLength);
