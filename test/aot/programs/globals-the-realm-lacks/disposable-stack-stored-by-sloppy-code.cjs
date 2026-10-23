// BUN_JSC_useExplicitResourceManagement=0 takes the global DisposableStack away. Sloppy code that stores to the bare name makes the global.
const told = [];
// The wording of an error is the engine's or the compiler's, so only its name is told.
function attempt(what, action) {
  try {
    told.push(what + ": " + String(action()));
  } catch (error) {
    told.push(what + ": " + error.name);
  }
}

attempt("typeof", () => typeof DisposableStack);
attempt("bare read", () => typeof DisposableStack.prototype);
attempt("store", () => {
  DisposableStack = { prototype: 1 };
  return "done";
});
attempt("typeof", () => typeof DisposableStack);
attempt("bare read", () => typeof DisposableStack.prototype);
attempt("delete", () => delete DisposableStack);
attempt("typeof", () => typeof DisposableStack);
console.log(told.join("\n"));
