const result = new URLSearchParams(1.5);
console.log(result instanceof URLSearchParams, Object.keys(result).join());
const items = [...result];
console.log(Array.isArray(items), items.length, Array.isArray(items[0]), items[0].length);
