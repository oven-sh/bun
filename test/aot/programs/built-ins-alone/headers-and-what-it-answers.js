const result = new Headers();
console.log(result instanceof Headers, Object.keys(result).join());
const items = [...result];
console.log(Array.isArray(items), items.length);
