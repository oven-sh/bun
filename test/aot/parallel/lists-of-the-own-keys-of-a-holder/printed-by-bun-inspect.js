const key = Object.getOwnPropertySymbols(Buffer.prototype).find(symbol =>
  String(symbol.description).endsWith("custom"),
);
console.log(Bun.inspect({ [key]: (depth, options, inspect) => "printed by Bun.inspect: " + inspect({ l: 12 }) }));
