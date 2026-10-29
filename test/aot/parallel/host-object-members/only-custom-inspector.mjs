// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
console.log({
  [Symbol.for("nodejs.util.inspect.custom")](depth, options, inspect) {
    return inspect({ depth, stylized: options.stylize("x", "string") });
  },
});
