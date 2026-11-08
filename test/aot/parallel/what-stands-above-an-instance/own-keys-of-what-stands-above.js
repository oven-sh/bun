const key = Reflect.ownKeys(Buffer.alloc(1).__proto__).find(
  name => typeof name === "symbol" && String(name.description).endsWith("custom"),
);
console.log({ [key]: (depth, options, inspect) => "own keys of what stands above: " + inspect({ a: 1 }) });
