// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
try {
  throw { [Symbol.for("nodejs.util.inspect.custom")]: (_, __, inspect) => "thrown " + inspect([1]) };
} catch (error) {
  console.error(error);
  console.log("done");
}
