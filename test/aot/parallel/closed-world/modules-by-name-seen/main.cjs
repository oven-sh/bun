// closed-world/modules-by-name-refused with one more line, in which the compiler sees a module loaded by a computed name: the loader is in the executable, and a computed name finds the built-in modules that are in it. A file that is no entry point is refused, as in an executable built without --aot.
// What native code hands back is unknown to the compiler, and so is text that is decoded at run time.
const unknown = value => new CustomEvent("unknown", { detail: value }).detail;
const decoded = text => Buffer.from(text).toString();
function outcome(error) {
  const message = String(error.message);
  return message.includes("bun compile differs from bun run here") ? "refused: " + message.replace(/'.*?'/, "'..'") : error.name;
}
function attempt(label, action) {
  try { console.log(label + ": " + action()); } catch (error) { console.log(label + ": " + outcome(error)); }
}
const inside = require("./inside.cjs");
// A built-in module that is written in JavaScript is in the executable only where the program names it.
const os = require("node:os");
const load = name => unknown(module)[decoded("require")](decoded(name));

attempt("a module of the executable", () => load("./inside.cjs") === inside);
attempt("a built-in module", () => load("node:os") === os);
attempt("process.getBuiltinModule", () => unknown(process)[decoded("getBuiltinModule")](decoded("node:os")) === os);
attempt("the module by its constant name", () => require("./inside.cjs").where);
attempt("require of a computed name, where the compiler sees it", () => require(decoded("./inside.cjs")).where);
/* Output:
a module of the executable: refused: Cannot load '..': this executable can't load a module from a dynamic path. Pass the file to bun compile as another entry point. (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
a built-in module: true
process.getBuiltinModule: true
the module by its constant name: inside
require of a computed name, where the compiler sees it: refused: Cannot load '..': this executable can't load a module from a dynamic path. Pass the file to bun compile as another entry point. (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
*/
