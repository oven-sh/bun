// The five hooks of the loader, stored under keys that the compiler cannot follow, first from sloppy code and then from strict code. All five take the function, as under `bun run`
// and in an executable of `bun build --compile`. A require() with a constant name asks none of them, as in that executable. The expected output is written down: `bun run` asks them.
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
sloppy .cjs nothing thrown REPLACED
sloppy wrap nothing thrown REPLACED
strict require nothing thrown REPLACED
strict _load nothing thrown REPLACED
strict _resolveFilename nothing thrown REPLACED
strict .cjs nothing thrown REPLACED
strict wrap nothing thrown REPLACED
1
*/
