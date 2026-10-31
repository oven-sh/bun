// Alone: what it prints depends on what else the executable holds: whether the printer of node:util was compiled in
const key = Object.getOwnPropertySymbols(Buffer.prototype).find(symbol => String(symbol.description).endsWith("custom"));
console.log(typeof key);
console.log({ [key]: (depth, options, inspect) => "listed on Buffer.prototype: " + inspect({ a: 1 }) });
