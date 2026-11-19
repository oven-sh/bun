const key = Object.getOwnPropertySymbols(Buffer.prototype).find(symbol =>
  String(symbol.description).endsWith("custom"),
);
console.log(typeof key);
console.log({ [key]: (depth, options, inspect) => "own symbols in sight: " + inspect({ a: 1 }) });
