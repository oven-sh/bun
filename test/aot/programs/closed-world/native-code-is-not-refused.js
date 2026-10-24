// Machine code that a program loads (an N-API addon, what bun:ffi loads) is native code like Bun's own, not JavaScript that the compiler has not seen. So the built-ins that load it answer as in plain Bun, however the program reaches them (the library does not exist). What an addon can do to a compiled program: ../../native-addons.test.ts.
// What native code hands back is unknown to the compiler, and so is text that is decoded at run time.
const unknown = value => new CustomEvent("unknown", { detail: value }).detail;
const decoded = text => Buffer.from(text).toString();
function outcome(error) {
  const message = String(error.message);
  return error.code === "ERR_CODE_NOT_COMPILED" ? "refused: " + message.replace(/'.*?'/, "'..'") : error.name;
}
function attempt(label, action) {
  try { console.log(label + ": " + action()); } catch (error) { console.log(label + ": " + outcome(error)); }
}
const missing = decoded("/no/such/folder/library");
const ffi = () => unknown(Bun)[decoded("FFI")];

attempt("process.dlopen", () => process.dlopen({ exports: {} }, missing + ".node"));
attempt("process.dlopen, reached in a way the compiler cannot follow", () => unknown(process)[decoded("dlopen")]({ exports: {} }, missing + ".node"));
attempt("dlopen of bun:ffi", () => ffi()[decoded("dlopen")](missing, {}));
attempt("linkSymbols of bun:ffi", () => typeof ffi()[decoded("linkSymbols")]({}));
