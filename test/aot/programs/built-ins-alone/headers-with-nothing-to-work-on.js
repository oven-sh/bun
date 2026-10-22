const first = new Headers();
const result = new Headers(first);
console.log(result instanceof Headers, Object.keys(result).join());
const items = [...result];
console.log(Array.isArray(items), items.length);
