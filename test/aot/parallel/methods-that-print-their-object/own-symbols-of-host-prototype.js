// Alone: what it prints depends on what else the executable holds: whether the printer of node:util was compiled in
const key = Object.getOwnPropertySymbols(URL.prototype).find(symbol => String(symbol.description).endsWith("custom"));
console.log(typeof key);
console.log({ [key]: (depth, options, inspect) => "listed on URL.prototype: " + inspect({ a: 1 }) });
