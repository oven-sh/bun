// BUN_JSC_useSharedArrayBuffer=0 takes the global SharedArrayBuffer away. Sloppy code that stores to the bare name makes the global.
const told = [];
// The wording of an error is the engine's or the compiler's, so only its name is told.
function attempt(what, action) {
  try {
    told.push(what + ": " + String(action()));
  } catch (error) {
    told.push(what + ": " + error.name);
  }
}

attempt("typeof", () => typeof SharedArrayBuffer);
attempt("bare read", () => typeof SharedArrayBuffer.prototype);
attempt("store", () => {
  SharedArrayBuffer = { prototype: 1 };
  return "done";
});
attempt("typeof", () => typeof SharedArrayBuffer);
attempt("bare read", () => typeof SharedArrayBuffer.prototype);
attempt("delete", () => delete SharedArrayBuffer);
attempt("typeof", () => typeof SharedArrayBuffer);
console.log(told.join("\n"));
