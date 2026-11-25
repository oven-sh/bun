const key = Object.getOwnPropertySymbols(Buffer.alloc(1).__proto__).find(symbol => String(symbol.description).endsWith("custom"));
console.log(typeof key);
console.log({ [key]: (depth, options, inspect) => "__proto__ of an instance: " + inspect({ d: 4 }) });
