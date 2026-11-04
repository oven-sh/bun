// Text from a string catches a module object with a getter above the module objects and stores a new object into its `exports`. The importer holds
// the first object. A later require() of the file answers the new one.
// Env of the executable: BUN_JSC_validateAOTRuntime=1
// Todo: needs oven-sh/WebKit#994. Without it the build does not see that the accessor of the text gets the module object, and the executable keeps a layout of the exports that no longer holds.
const inner = require("./inner.cjs");
const replaceExports = new Function(`
  const caught = [];
  const Module = process.getBuiltinModule("node:module");
  const above = Object.getPrototypeOf(new Module("made"));
  Object.defineProperty(above, "hot", { configurable: true, get() { caught.push(this); return undefined; } });
  return function replaceExports() {
    for (const caughtModule of caught) caughtModule.exports = { secret() { return "of the new exports"; } };
    return caught.length;
  };
`)();
console.log(inner.isHot());
console.log(replaceExports());
console.log(inner.secret(), require("./inner.cjs").secret(), require("./inner.cjs") === inner);
