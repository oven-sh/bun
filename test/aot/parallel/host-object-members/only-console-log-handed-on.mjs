// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const inspected = {
  [Symbol.for("nodejs.util.inspect.custom")]: (depth, options, inspect) => "inspected " + inspect([depth]),
};
[inspected].forEach(console.log);
