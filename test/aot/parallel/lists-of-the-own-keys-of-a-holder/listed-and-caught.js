const key = Object.getOwnPropertySymbols(Buffer.prototype).find(symbol =>
  String(symbol.description).endsWith("custom"),
);
try {
  console.log({ [key]: (depth, options, inspect) => "listed and caught: " + inspect({ n: 14 }) });
} catch (error) {
  console.log("caught", String(error.message).slice(0, 40));
}
