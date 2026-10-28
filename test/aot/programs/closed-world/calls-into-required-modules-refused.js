// closed-world/calls-into-loaded-modules-refused without the loads by computed names: the modules are required by their constant names alone, and that opens nothing either. The program calls what they export in a way the compiler cannot follow, and the calls throw. It is built with --no-compile-function-source, so each error also says to rebuild without that flag. node:repl is not among the modules: its own code compiles text, which the compiler sees, and a program that requires it runs text from then on.
// What native code hands back is unknown to the compiler, and so is text that is decoded at run time.
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
const vm = unknown(require("node:vm"));
const ffi = unknown(require("bun:ffi"));
const threads = unknown(require("node:worker_threads"));
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
