// Text from a string puts a getter on the object above every require function, and a file of the program reads that name off its own `require`.
// The getter gets that function. In an executable it leads to no module object and loads no file of the program for the text, so what the file exports stays
// in the program. Under `bun run` the text gets the module object of main.cjs and the exports of inner.cjs through it.
const inner = require("./inner.cjs");
const useWhatWasCaught = new Function(`
  const caught = [];
  const Module = process.getBuiltinModule("node:module");
  const above = Object.getPrototypeOf(Module.createRequire(process.cwd() + "/made.cjs"));
  Object.defineProperty(above, "context", { configurable: true, get() { caught.push(this); return undefined; } });
  return function useWhatWasCaught() {
    const seen = [];
    for (const caughtRequire of caught) {
      seen.push(typeof caughtRequire, typeof caughtRequire.main);
      try {
        caughtRequire("./inner.cjs").secret = function replaced() { return "replaced from outside"; };
        seen.push("loaded");
      } catch (error) {
        seen.push("throws " + error.name);
      }
    }
    return seen.join(" ");
  };
`)();
console.log(inner.hasContext());
console.log(useWhatWasCaught());
console.log(inner.secret());
/* Output:
plain
function undefined throws Error
secret of inner
*/
