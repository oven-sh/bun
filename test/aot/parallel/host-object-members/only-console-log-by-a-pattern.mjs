// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
const inspected = {
  [Symbol.for("nodejs.util.inspect.custom")]: (depth, options, inspect) => "inspected " + inspect([depth]),
};
const { log, error: complain } = console;
log(inspected);
complain(inspected);
