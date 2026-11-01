// Custom inspect method copied by own keys assign and spread.
const source = { [Symbol.for("nodejs.util.inspect.custom")]() { return "copied"; } };
const copy = {};
for (const key of Reflect.ownKeys(source)) copy[key] = source[key];
console.log(copy, Object.assign({}, source), { ...source });
