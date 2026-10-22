const first = new Headers({ first: "1", second: "two" });
const result = new Headers(first);
console.log(result instanceof Headers, Object.keys(result).join());
const items = [...result];
console.log(Array.isArray(items), items.length, Array.isArray(items[0]), items[0].length);
console.log(Array.isArray(items[1]), items[1].length);
