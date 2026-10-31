// closed-world/script-declarations-over-locked-globals for the globals that a program may replace: they are constants in a program that reads them and does not write them, and then a script may not shadow them either. So is one that the program only tests with typeof. A name that the global object lacks is looked up at run time and can be shadowed.
// Alone: what it prints hangs on what else the executable holds: which modules and members were compiled in, and whether anything evaluates text
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
/* Output:
before: number /path 1 object undefined
let process: SyntaxError: Cannot declare 'process': compiled code treats the global 'process' as a constant, so a script can't shadow it with a top-level let, const or class (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
class URL: SyntaxError: Cannot declare 'URL': compiled code treats the global 'URL' as a constant, so a script can't shadow it with a top-level let, const or class (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
const Buffer: SyntaxError: Cannot declare 'Buffer': compiled code treats the global 'Buffer' as a constant, so a script can't shadow it with a top-level let, const or class (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
let navigator: SyntaxError: Cannot declare 'navigator': compiled code treats the global 'navigator' as a constant, so a script can't shadow it with a top-level let, const or class (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
let widget: of the script
after: number /path 1 object string
in a later script: number /path 1 object string
var process: TypeError: Cannot assign to process because built-in objects are read-only in a compiled executable (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
function URL: TypeError: Can't declare global function 'URL': property must be either configurable or both writable and enumerable
in a new context: of the context
*/
