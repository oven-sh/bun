// Text from a string puts a getter on the object above every module object before the program requires a file. The body of the file reads the name
// off its `module` while it runs: the getter gets the module object when the file has exported one name of three.
// Env of the executable: BUN_JSC_validateAOTRuntime=1
// Todo: needs oven-sh/WebKit#994. Without it the build does not see that the accessor of the text gets the module object, and the executable keeps a layout of the exports that no longer holds.
const replaceWhatWasCaught = new Function(`
  const caught = [];
  const Module = process.getBuiltinModule("node:module");
  const above = Object.getPrototypeOf(new Module("made"));
  Object.defineProperty(above, "hot", {
    configurable: true,
    get() {
      caught.push(this);
      this.exports.seenByTheGetter = Object.keys(this.exports).join();
      return "early";
    },
  });
  return function replaceWhatWasCaught() {
    const seen = [];
    for (const caughtModule of caught) {
      seen.push(Object.keys(caughtModule.exports).join());
      caughtModule.exports.secret = function replaced() { return "replaced from outside"; };
    }
    return seen.join(" | ");
  };
`)();
const inner = require("./inner.cjs");
console.log(inner.early, inner.seenByTheGetter, Object.keys(inner).join());
console.log(replaceWhatWasCaught());
console.log(inner.secret());
