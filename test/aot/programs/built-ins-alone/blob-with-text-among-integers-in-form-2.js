const first = [1, 2, 3];
const result = new Blob(first, "text");
console.log(result instanceof Blob, Object.keys(result).join());
