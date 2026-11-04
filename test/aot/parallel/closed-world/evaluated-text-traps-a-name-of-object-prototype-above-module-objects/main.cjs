// As evaluated-text-traps-a-name-above-the-module-objects, and the name is one that Object.prototype has: the getter of the text lies in front of it.
// Env of the executable: BUN_JSC_validateAOTRuntime=1
// Todo: needs oven-sh/WebKit#994. Without it the build does not see that the accessor of the text gets the module object, and the executable keeps a layout of the exports that no longer holds.
const inner = require("./inner.cjs");
const replaceWhatWasCaught = new Function(`
  const caught = [];
  const Module = process.getBuiltinModule("node:module");
  const above = Object.getPrototypeOf(new Module("made"));
  Object.defineProperty(above, "valueOf", { configurable: true, get() { caught.push(this); return "got"; } });
  return function replaceWhatWasCaught() {
    const seen = [];
    for (const caughtModule of caught) {
      seen.push(Object.keys(caughtModule.exports).join());
      caughtModule.exports.secret = function replaced() { return "replaced from outside"; };
    }
    return seen.join(" | ");
  };
`)();
console.log(inner.valueOfModule());
console.log(replaceWhatWasCaught());
console.log(inner.secret());
