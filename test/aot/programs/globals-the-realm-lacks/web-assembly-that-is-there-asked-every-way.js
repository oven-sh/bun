// The global WebAssembly is there, as in every run without an option. Nothing here stores to the name. Each way of asking for it answers as a lookup in the realm of the run does.
const told = [];
// The wording of an error is the engine's or the compiler's, so only its name is told.
function attempt(what, action) {
  try {
    told.push(what + ": " + String(action()));
  } catch (error) {
    told.push(what + ": " + error.name);
  }
}

const key = ["Web", "Assembly"].join("");

function ask() {
  attempt("typeof", () => typeof WebAssembly);
  attempt("typeof is not undefined", () => typeof WebAssembly !== "undefined");
  attempt("typeof is undefined", () => (typeof WebAssembly === "undefined" ? "absent" : "present"));
  attempt("typeof is the kind", () => typeof WebAssembly === "object");
  attempt("used behind typeof", () => (typeof WebAssembly !== "undefined" ? typeof WebAssembly.validate : "went around"));
  attempt("bare read", () => WebAssembly === undefined);
  attempt("bare read that is kept", () => {
    const held = WebAssembly;
    return [typeof held, typeof held].join();
  });
  attempt("call", () => typeof WebAssembly());
  attempt("construction", () => typeof new WebAssembly());
  attempt("member", () => typeof WebAssembly.validate);
  attempt("call of a member", () => typeof WebAssembly.toString());
  attempt("instanceof", () => ({}) instanceof WebAssembly);
  attempt("in", () => "WebAssembly" in globalThis);
  attempt("hasOwn", () => Object.hasOwn(globalThis, "WebAssembly"));
  attempt("descriptor", () => typeof Object.getOwnPropertyDescriptor(globalThis, "WebAssembly"));
  attempt("member of globalThis", () => typeof globalThis.WebAssembly);
  attempt("by a key that is written", () => typeof globalThis["WebAssembly"]);
  attempt("by a key that is made", () => typeof globalThis[key]);
  attempt("truth", () => (globalThis.WebAssembly ? "true" : "false"));
  attempt("not", () => !globalThis.WebAssembly);
  attempt("and", () => typeof (globalThis.WebAssembly && globalThis.WebAssembly.validate));
  attempt("nothing else", () => typeof (globalThis.WebAssembly ?? "nothing"));
  attempt("optional member", () => typeof globalThis.WebAssembly?.validate);
  attempt("optional call", () => typeof globalThis.WebAssembly?.());
  attempt("optional call of a member", () => typeof globalThis.WebAssembly?.toString?.());
  attempt("taken apart", () => {
    const { WebAssembly: held } = globalThis;
    return typeof held;
  });
  attempt("taken apart with a default", () => {
    const { WebAssembly: held = "default" } = globalThis;
    return typeof held;
  });
}

// Often enough for whatever remembers the first answer.
for (let round = 0; round < 40; round++) {
  told.length = 0;
  ask();
}
console.log(told.join("\n"));
