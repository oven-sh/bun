// BUN_JSC_useShadowRealm=0 takes the global ShadowRealm away. Sloppy code that stores to the bare name makes the global.
const told = [];
// The wording of an error is the engine's or the compiler's, so only its name is told.
function attempt(what, action) {
  try {
    told.push(what + ": " + String(action()));
  } catch (error) {
    told.push(what + ": " + error.name);
  }
}

attempt("typeof", () => typeof ShadowRealm);
attempt("bare read", () => typeof ShadowRealm.prototype);
attempt("store", () => {
  ShadowRealm = { prototype: 1 };
  return "done";
});
attempt("typeof", () => typeof ShadowRealm);
attempt("bare read", () => typeof ShadowRealm.prototype);
attempt("delete", () => delete ShadowRealm);
attempt("typeof", () => typeof ShadowRealm);
console.log(told.join("\n"));
