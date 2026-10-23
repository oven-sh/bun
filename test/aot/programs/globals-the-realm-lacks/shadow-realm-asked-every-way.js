// BUN_JSC_useShadowRealm=0 takes the global ShadowRealm away. Nothing here stores to the name. Each way of asking for it answers as a lookup in the realm of the run does.
const told = [];
// The wording of an error is the engine's or the compiler's, so only its name is told.
function attempt(what, action) {
  try {
    told.push(what + ": " + String(action()));
  } catch (error) {
    told.push(what + ": " + error.name);
  }
}

const key = ["Sha", "dowRealm"].join("");

function ask() {
  attempt("typeof", () => typeof ShadowRealm);
  attempt("typeof is not undefined", () => typeof ShadowRealm !== "undefined");
  attempt("typeof is undefined", () => (typeof ShadowRealm === "undefined" ? "absent" : "present"));
  attempt("typeof is the kind", () => typeof ShadowRealm === "function");
  attempt("used behind typeof", () => (typeof ShadowRealm !== "undefined" ? typeof ShadowRealm.prototype : "went around"));
  attempt("bare read", () => ShadowRealm === undefined);
  attempt("bare read that is kept", () => {
    const held = ShadowRealm;
    return [typeof held, typeof held].join();
  });
  attempt("call", () => typeof ShadowRealm());
  attempt("construction", () => typeof new ShadowRealm());
  attempt("member", () => typeof ShadowRealm.prototype);
  attempt("call of a member", () => typeof ShadowRealm.toString());
  attempt("instanceof", () => ({}) instanceof ShadowRealm);
  attempt("in", () => "ShadowRealm" in globalThis);
  attempt("hasOwn", () => Object.hasOwn(globalThis, "ShadowRealm"));
  attempt("descriptor", () => typeof Object.getOwnPropertyDescriptor(globalThis, "ShadowRealm"));
  attempt("member of globalThis", () => typeof globalThis.ShadowRealm);
  attempt("by a key that is written", () => typeof globalThis["ShadowRealm"]);
  attempt("by a key that is made", () => typeof globalThis[key]);
  attempt("truth", () => (globalThis.ShadowRealm ? "true" : "false"));
  attempt("not", () => !globalThis.ShadowRealm);
  attempt("and", () => typeof (globalThis.ShadowRealm && globalThis.ShadowRealm.prototype));
  attempt("nothing else", () => typeof (globalThis.ShadowRealm ?? "nothing"));
  attempt("optional member", () => typeof globalThis.ShadowRealm?.prototype);
  attempt("optional call", () => typeof globalThis.ShadowRealm?.());
  attempt("optional call of a member", () => typeof globalThis.ShadowRealm?.toString?.());
  attempt("taken apart", () => {
    const { ShadowRealm: held } = globalThis;
    return typeof held;
  });
  attempt("taken apart with a default", () => {
    const { ShadowRealm: held = "default" } = globalThis;
    return typeof held;
  });
}

// Often enough for whatever remembers the first answer.
for (let round = 0; round < 40; round++) {
  told.length = 0;
  ask();
}
console.log(told.join("\n"));
