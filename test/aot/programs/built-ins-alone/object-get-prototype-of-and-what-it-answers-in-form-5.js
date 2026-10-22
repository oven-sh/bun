const result = Object.getPrototypeOf("an");
console.log(typeof result, Object.keys(result).join());
const items = [...result];
console.log(Array.isArray(items), items.length);
