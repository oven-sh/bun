// BUN_JSC_useWasm=0 takes the global WebAssembly away. Sloppy code that stores to the bare name makes the global.
// Env: BUN_JSC_useWasm=0
const told = [];
// The wording of an error is the engine's or the compiler's, so only its name is told.
function attempt(what, action) {
  try {
    told.push(what + ": " + String(action()));
  } catch (error) {
    told.push(what + ": " + error.name);
  }
}

attempt("typeof", () => typeof WebAssembly);
attempt("bare read", () => typeof WebAssembly.validate);
attempt("store", () => {
  WebAssembly = { validate: 1 };
  return "done";
});
attempt("typeof", () => typeof WebAssembly);
attempt("bare read", () => typeof WebAssembly.validate);
attempt("delete", () => delete WebAssembly);
attempt("typeof", () => typeof WebAssembly);
console.log(told.join("\n"));
