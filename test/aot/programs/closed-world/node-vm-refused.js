// A program that names node:vm nowhere gets it only by a name the compiler cannot follow, and that load throws. closed-world/node-vm-admitted is the same program built with --compile-inspector.
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
const text = decoded("1 + 1");
const load = name => unknown(process)[decoded("getBuiltinModule")](decoded(name));

attempt("vm.runInNewContext", () => load("node:vm").runInNewContext(text));
attempt("vm.Script", () => new (load("node:vm").Script)(text).runInThisContext());
attempt("vm.compileFunction", () => load("node:vm").compileFunction("return " + text)());
