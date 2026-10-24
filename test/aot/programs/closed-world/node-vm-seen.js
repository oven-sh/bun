// A program that requires node:vm by its name evaluates text with it as in plain Bun, with no option.
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
const vm = require("node:vm");
const text = decoded("1 + 1");

attempt("vm.runInNewContext", () => vm.runInNewContext(text));
attempt("vm.Script", () => new vm.Script(text).runInThisContext());
attempt("vm.compileFunction", () => vm.compileFunction("return " + text)());
attempt("eval in a context", () => vm.runInNewContext("eval(text)", { text }));
