// An object that becomes the text.
const key = Symbol.for({ toString: () => "nodejs.util.inspect.custom" });
console.log({ [key]: (depth, options, inspect) => `held ${typeof inspect} ${inspect({ a: 1 })}` });
