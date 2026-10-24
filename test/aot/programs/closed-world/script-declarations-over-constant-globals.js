// closed-world/script-declarations-over-locked-globals for the globals that a program may replace: they are constants in a program that reads them and does not write them, and then a script may not shadow them either. So is one that the program only tests with typeof. A name that the global object lacks is looked up at run time and can be shadowed.
const vm = require("node:vm");
const print = console.log;
function attempt(label, action) {
  try { print(label + ": " + action()); } catch (error) { print(label + ": " + error.name + ": " + error.message); }
}
function readGlobals() {
  return [typeof process.pid, new URL("http://host/path").pathname, Buffer.from("a").length, typeof navigator, typeof widget].join(" ");
}

attempt("before", readGlobals);
attempt("let process", () => vm.runInThisContext("let process = { pid: 'of the script' }; process.pid"));
attempt("class URL", () => new vm.Script("class URL { get pathname() { return 'of the script'; } } new URL().pathname").runInThisContext());
attempt("const Buffer", () => vm.runInThisContext("const Buffer = { from: () => 'of the script' }; Buffer.from('a')"));
attempt("let navigator", () => vm.runInThisContext("let navigator = 'of the script'; navigator"));
attempt("let widget", () => vm.runInThisContext("let widget = 'of the script'; widget"));
attempt("after", readGlobals);
attempt("in a later script", () => vm.runInThisContext("[typeof process.pid, new URL('http://host/path').pathname, Buffer.from('a').length, typeof navigator, typeof widget].join(' ')"));
attempt("var process", () => vm.runInThisContext("var process = 'of the script'; typeof process"));
attempt("function URL", () => vm.runInThisContext("function URL() { } typeof URL"));
attempt("in a new context", () => vm.runInNewContext("let process = 'of the context'; class URL { } process"));
