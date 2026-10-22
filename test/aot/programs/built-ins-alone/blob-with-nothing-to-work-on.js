const first = [];
const result = new Blob(first, null);
console.log(result instanceof Blob, Object.keys(result).join());
