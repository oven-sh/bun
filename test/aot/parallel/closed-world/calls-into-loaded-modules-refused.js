// Loading a module is no call of what it exports: the program names node:vm, bun:ffi and node:worker_threads and loads them again by computed names, and that opens nothing. The compiler sees no place where this program evaluates text, loads machine code or starts a thread from text, and counts on it, so the calls that do so throw, and the error says why. closed-world/calls-into-loaded-modules-admitted is the same program with node:repl, built with --compile-inspector. node:repl is not among the modules here: its own code compiles text, which the compiler sees, and a program that requires it runs text from then on. node:worker_threads reaches nothing that evaluates text in this realm or loads machine code: a module like that is compiled whole once the program hands it on, so its Worker is made.
// What native code hands back is unknown to the compiler, and so is text that is decoded at run time.
// Flags: --aot-refuse-code-from-disk
// Alone: what it prints depends on what else the executable holds: which modules and members were compiled in, and whether anything evaluates text
const unknown = value => new CustomEvent("unknown", { detail: value }).detail;
const decoded = text => Buffer.from(text).toString();
function outcome(error) {
  const message = String(error.message);
  const isRefusal = message.includes("the compiler couldn't tell at build time") || error.code === "ERR_CODE_NOT_COMPILED" || message.includes("bun compile differs from bun run here");
  return isRefusal ? "refused: " + message.replace(/'.*?'/, "'..'") : error.name;
}
function attempt(label, action) {
  try { console.log(label + ": " + action()); } catch (error) { console.log(label + ": " + outcome(error)); }
}
// A built-in module that is written in JavaScript is in the executable only where the program names it.
const named = [require("node:vm"), require("bun:ffi"), require("node:worker_threads")];
// The compiler follows what a load by a computed name answers, so the answer goes through native code.
const load = name => unknown(require(decoded(name)));
const vm = load("node:vm");
const ffi = load("bun:ffi");
const threads = load("node:worker_threads");
attempt("the modules by their constant names", () => [vm, ffi, threads].every((loaded, index) => loaded === named[index]));
attempt("process.getBuiltinModule", () => process.getBuiltinModule(decoded("node:vm")) === vm);
const text = decoded("1 + 1");
const missing = decoded("/no/such/folder/library");

// A member under a name that the compiler reads is looked for in every built-in object of that name.
const call = (object, name, ...operands) => object[decoded(name)](...operands);
const construct = (object, name, ...operands) => new object[decoded(name)](...operands);

attempt("vm.createContext", () => typeof call(vm, "createContext", {}));
attempt("vm.runInNewContext", () => call(vm, "runInNewContext", text));
attempt("vm.runInThisContext", () => call(vm, "runInThisContext", text));
attempt("vm.runInContext", () => call(vm, "runInContext", text, call(vm, "createContext", {})));
attempt("vm.Script", () => call(construct(vm, "Script", text), "runInThisContext"));
attempt("vm.compileFunction", () => call(vm, "compileFunction", "return " + text)());
attempt("vm.SourceTextModule", () => typeof construct(vm, "SourceTextModule", "export default " + text));
attempt("module._compile", () => call(unknown(module), "_compile", "module.exports = " + text, decoded("/made-at-run-time.js")));
attempt("ffi.dlopen", () => call(ffi, "dlopen", missing, { nothing: { args: [], returns: "void" } }));
attempt("ffi.linkSymbols", () => typeof call(ffi, "linkSymbols", { nothing: { ptr: 1, args: [], returns: "void" } }));
attempt("ffi.CFunction", () => typeof call(ffi, "CFunction", { ptr: 1, args: [], returns: "void" }));
attempt("a Worker of node:worker_threads from text", () => typeof call(construct(threads, "Worker", "process.exit(0)", { eval: true }), "terminate"));
/* Output:
the modules by their constant names: true
process.getBuiltinModule: true
vm.createContext: refused: '..' was not compiled into this executable because your code never calls it. To keep it, call it somewhere in your code. (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
vm.runInNewContext: refused: '..' was not compiled into this executable because your code never calls it. To keep it, call it somewhere in your code. (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
vm.runInThisContext: refused: '..' was not compiled into this executable because your code never calls it. To keep it, call it somewhere in your code. (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
vm.runInContext: refused: '..' was not compiled into this executable because your code never calls it. To keep it, call it somewhere in your code. (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
vm.Script: refused: Code generation from strings disallowed for this context: the compiler couldn't tell at build time that this call reaches eval() or the Function constructor. Call eval() or new Function() directly.
vm.compileFunction: refused: Code generation from strings disallowed for this context: the compiler couldn't tell at build time that this call reaches eval() or the Function constructor. Call eval() or new Function() directly.
vm.SourceTextModule: refused: '..' was not compiled into this executable because your code never calls it. To keep it, call it somewhere in your code. (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
module._compile: refused: Code generation from strings disallowed for this context: the compiler couldn't tell at build time that this call reaches eval() or the Function constructor. Call eval() or new Function() directly.
ffi.dlopen: refused: '..' was not compiled into this executable because your code never calls it. To keep it, call it somewhere in your code. (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
ffi.linkSymbols: refused: '..' was not compiled into this executable because your code never calls it. To keep it, call it somewhere in your code. (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
ffi.CFunction: refused: '..' was not compiled into this executable because your code never calls it. To keep it, call it somewhere in your code. (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
a Worker of node:worker_threads from text: object
*/
