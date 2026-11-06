// closed-world/modules-by-name-refused built with --compile-inspector. A debugger can run any code, so the compiler counts on nothing about the names that such a build loads modules by: every load answers as in plain Bun.
// What native code hands back is unknown to the compiler, and so is text that is decoded at run time.
// Flags: --compile-inspector
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
