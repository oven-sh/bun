// BUN_JSC_useTemporal=0 takes the global Temporal away. Nothing here stores to the name. Each way of asking for it answers as a lookup in the realm of the run does.
const told = [];
// The wording of an error is the engine's or the compiler's, so only its name is told.
function attempt(what, action) {
  try {
    told.push(what + ": " + String(action()));
  } catch (error) {
    told.push(what + ": " + error.name);
  }
}

const key = ["Tem", "poral"].join("");

function ask() {
  attempt("typeof", () => typeof Temporal);
  attempt("typeof is not undefined", () => typeof Temporal !== "undefined");
  attempt("typeof is undefined", () => (typeof Temporal === "undefined" ? "absent" : "present"));
  attempt("typeof is the kind", () => typeof Temporal === "object");
  attempt("used behind typeof", () => {
    if (typeof Temporal === "undefined") return "went around";
    return typeof Temporal.Now;
  });
  attempt("bare read", () => Temporal === undefined);
  attempt("bare read that is kept", () => {
    const held = Temporal;
    return [typeof held, typeof held].join();
  });
  attempt("call", () => typeof Temporal());
  attempt("construction", () => typeof new Temporal());
  attempt("member", () => typeof Temporal.Now);
  attempt("call of a member", () => typeof Temporal.toString());
  attempt("instanceof", () => ({}) instanceof Temporal);
  attempt("in", () => "Temporal" in globalThis);
  attempt("hasOwn", () => Object.hasOwn(globalThis, "Temporal"));
  attempt("descriptor", () => typeof Object.getOwnPropertyDescriptor(globalThis, "Temporal"));
  attempt("member of globalThis", () => typeof globalThis.Temporal);
  attempt("by a key that is written", () => typeof globalThis["Temporal"]);
  attempt("by a key that is made", () => typeof globalThis[key]);
  attempt("truth", () => (globalThis.Temporal ? "true" : "false"));
  attempt("not", () => !globalThis.Temporal);
  attempt("and", () => typeof (globalThis.Temporal && globalThis.Temporal.Now));
  attempt("nothing else", () => typeof (globalThis.Temporal ?? "nothing"));
  attempt("optional member", () => typeof globalThis.Temporal?.Now);
  attempt("optional call", () => typeof globalThis.Temporal?.());
  attempt("optional call of a member", () => typeof globalThis.Temporal?.toString?.());
  attempt("taken apart", () => {
    const { Temporal: held } = globalThis;
    return typeof held;
  });
  attempt("taken apart with a default", () => {
    const { Temporal: held = "default" } = globalThis;
    return typeof held;
  });
}

// Often enough for whatever remembers the first answer.
for (let round = 0; round < 40; round++) {
  told.length = 0;
  ask();
}
console.log(told.join("\n"));
