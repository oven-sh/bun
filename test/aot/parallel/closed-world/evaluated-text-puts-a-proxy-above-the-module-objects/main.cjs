// Text from a string puts a Proxy above the object above every module object. A file of the program reads a name off its own `module` that
// nothing below the Proxy has: the trap gets the module object as the receiver, and through it what the file exports.
// Env of the executable: BUN_JSC_validateAOTRuntime=1
// Todo: needs oven-sh/WebKit#994. Without it the build does not see that the accessor of the text gets the module object, and the executable keeps a layout of the exports that no longer holds.
const inner = require("./inner.cjs");
const replaceWhatWasCaught = new Function(`
  const caught = [];
  const Module = process.getBuiltinModule("node:module");
  const above = Object.getPrototypeOf(new Module("made"));
  Object.setPrototypeOf(above, new Proxy({}, {
    get(target, key, receiver) {
      if (key !== "hot") return undefined;
      caught.push(receiver);
      return "trapped";
    },
  }));
  return function replaceWhatWasCaught() {
    const seen = [];
    for (const caughtModule of caught) {
      seen.push(Object.keys(caughtModule.exports).join());
      caughtModule.exports.secret = function replaced() { return "replaced from outside"; };
    }
    return seen.join(" | ");
  };
`)();
console.log(inner.isHot());
console.log(replaceWhatWasCaught());
console.log(inner.secret());
