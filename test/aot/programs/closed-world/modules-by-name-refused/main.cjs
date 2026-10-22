// The compiler follows every name that this program loads a module by and counts on it: on which modules run, and in which order. A loader that the program reaches in a way the compiler cannot follow throws whatever the name resolves to, and the error says what to do instead. closed-world/modules-by-name-admitted is the same program built with --compile-inspector.
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
