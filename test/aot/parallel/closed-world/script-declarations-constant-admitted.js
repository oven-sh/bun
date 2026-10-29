// closed-world/script-declarations-over-constant-globals built with --compile-inspector. A debugger can run any code, so the compiler takes none of these globals for a constant: a script may shadow each of them, and compiled code sees the binding from then on, as in plain Bun.
// Flags: --compile-inspector
const vm = require("node:vm");
const print = console.log;
function attempt(label, action) {
  try { print(label + ": " + action()); } catch (error) { print(label + ": " + error.name + ": " + error.message); }
}
function readGlobals() {
  return [typeof performance.timeOrigin, new URL("http://host/path").pathname, Buffer.from("a").length, typeof navigator].join(" ");
}

attempt("before", readGlobals);
attempt("let performance", () => vm.runInThisContext("let performance = { timeOrigin: 'of the script' }; performance.timeOrigin"));
attempt("class URL", () => new vm.Script("class URL { get pathname() { return 'of the script'; } } new URL().pathname").runInThisContext());
attempt("const Buffer", () => vm.runInThisContext("const Buffer = { from: () => 'of the script' }; Buffer.from('a')"));
attempt("let navigator", () => vm.runInThisContext("let navigator = 'of the script'; navigator"));
attempt("after", readGlobals);
attempt("in a later script", () => vm.runInThisContext("[typeof performance.timeOrigin, new URL('http://host/path').pathname, Buffer.from('a').length, typeof navigator].join(' ')"));
attempt("var performance", () => vm.runInThisContext("var performance = 'of the script'; typeof performance"));
attempt("function URL", () => vm.runInThisContext("function URL() { } typeof URL"));
attempt("in a new context", () => vm.runInNewContext("let process = 'of the context'; class URL { } process"));
