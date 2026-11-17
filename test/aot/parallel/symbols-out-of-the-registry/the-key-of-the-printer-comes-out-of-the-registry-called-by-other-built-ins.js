// The registry is called by call, apply and Reflect.apply.
for (const key of [Symbol.for.call(Symbol, "nodejs.util.inspect.custom"), Symbol.for.apply(Symbol, ["nodejs.util.inspect.custom"]), Reflect.apply(Symbol.for, Symbol, ["nodejs.util.inspect.custom"])]) {
  console.log({ [key]: (depth, options, inspect) => `held ${typeof inspect} ${inspect({ a: 1 })}` });
}
