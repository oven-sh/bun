// The five hooks of the loader, stored under keys that the compiler cannot follow, first from sloppy code and then from strict code. Four take the function, as under `bun run`.
// The table of extensions hears of every store, and throws for an extension that a file of the executable has. A require() with a constant name asks none of them. The expected output is written down: `bun run` stores all five, and asks them.
const Module = require("node:module");
const suffix = process.env.NO_SUCH_VARIABLE ?? "";
const hooks = [[Module.prototype, "require"], [Module, "_load"], [Module, "_resolveFilename"], [Module._extensions, ".cjs"], [Module, "wrap"]];
exports.hooks = hooks;
exports.suffix = suffix;
for (const [object, name] of hooks) {
  const before = object[name + suffix];
  let outcome = "nothing thrown";
  try {
    object[name + suffix] = () => "hooked";
  } catch (error) {
    outcome = error.constructor.name;
  }
  console.log("sloppy", name, outcome, object[name + suffix] === before ? "as before" : "REPLACED");
}
require("./strict.mjs");
console.log(require("./a.cjs").x);
/* Output:
sloppy require nothing thrown REPLACED
sloppy _load nothing thrown REPLACED
sloppy _resolveFilename nothing thrown REPLACED
sloppy .cjs Error as before
sloppy wrap nothing thrown REPLACED
strict require nothing thrown REPLACED
strict _load nothing thrown REPLACED
strict _resolveFilename nothing thrown REPLACED
strict .cjs Error as before
strict wrap nothing thrown REPLACED
1
*/
