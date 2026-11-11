// With a second operand the call goes by its row, and the text is held against the key of the printer there.
const key = Symbol.for("nodejs.util.inspect.custom", 0);
console.log({ [key]: (depth, options, inspect) => `held ${typeof inspect} ${inspect({ a: 1 })}` });
