// Alone: what it prints depends on what else the executable holds: whether the printer of node:util was compiled in
const key = Reflect.ownKeys(ReadableStream.prototype).find(name => typeof name === "symbol" && String(name.description).endsWith("custom"));
console.log(typeof key);
const printed = {};
printed[key] = (depth, options, inspect) => "listed on ReadableStream.prototype: " + inspect([1, 2]);
console.log(printed);
