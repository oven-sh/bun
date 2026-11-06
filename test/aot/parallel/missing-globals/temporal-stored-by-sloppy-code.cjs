// BUN_JSC_useTemporal=0 takes the global Temporal away. Sloppy code that stores to the bare name makes the global.
// Env: BUN_JSC_useTemporal=0
const told = [];
// The wording of an error is the engine's or the compiler's, so only its name is told.
function attempt(what, action) {
  try {
    told.push(what + ": " + String(action()));
  } catch (error) {
    told.push(what + ": " + error.name);
  }
}

attempt("typeof", () => typeof Temporal);
attempt("bare read", () => typeof Temporal.Now);
attempt("store", () => {
  Temporal = { Now: 1 };
  return "done";
});
attempt("typeof", () => typeof Temporal);
attempt("bare read", () => typeof Temporal.Now);
attempt("delete", () => delete Temporal);
attempt("typeof", () => typeof Temporal);
console.log(told.join("\n"));
