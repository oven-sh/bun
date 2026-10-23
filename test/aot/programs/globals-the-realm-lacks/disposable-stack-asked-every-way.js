// BUN_JSC_useExplicitResourceManagement=0 takes the global DisposableStack away. Nothing here stores to the name. Each way of asking for it answers as a lookup in the realm of the run does.
const told = [];
// The wording of an error is the engine's or the compiler's, so only its name is told.
function attempt(what, action) {
  try {
    told.push(what + ": " + String(action()));
  } catch (error) {
    told.push(what + ": " + error.name);
  }
}

const key = ["Dis", "posableStack"].join("");

function ask() {
  attempt("typeof", () => typeof DisposableStack);
  attempt("typeof is not undefined", () => typeof DisposableStack !== "undefined");
  attempt("typeof is undefined", () => (typeof DisposableStack === "undefined" ? "absent" : "present"));
  attempt("typeof is the kind", () => typeof DisposableStack === "function");
  attempt("used behind typeof", () => (typeof DisposableStack !== "undefined" ? typeof DisposableStack.prototype : "went around"));
  attempt("bare read", () => DisposableStack === undefined);
  attempt("bare read that is kept", () => {
    const held = DisposableStack;
    return [typeof held, typeof held].join();
  });
  attempt("call", () => typeof DisposableStack());
  attempt("construction", () => typeof new DisposableStack());
  attempt("member", () => typeof DisposableStack.prototype);
  attempt("call of a member", () => typeof DisposableStack.toString());
  attempt("instanceof", () => ({}) instanceof DisposableStack);
  attempt("in", () => "DisposableStack" in globalThis);
  attempt("hasOwn", () => Object.hasOwn(globalThis, "DisposableStack"));
  attempt("descriptor", () => typeof Object.getOwnPropertyDescriptor(globalThis, "DisposableStack"));
  attempt("member of globalThis", () => typeof globalThis.DisposableStack);
  attempt("by a key that is written", () => typeof globalThis["DisposableStack"]);
  attempt("by a key that is made", () => typeof globalThis[key]);
  attempt("truth", () => (globalThis.DisposableStack ? "true" : "false"));
  attempt("not", () => !globalThis.DisposableStack);
  attempt("and", () => typeof (globalThis.DisposableStack && globalThis.DisposableStack.prototype));
  attempt("nothing else", () => typeof (globalThis.DisposableStack ?? "nothing"));
  attempt("optional member", () => typeof globalThis.DisposableStack?.prototype);
  attempt("optional call", () => typeof globalThis.DisposableStack?.());
  attempt("optional call of a member", () => typeof globalThis.DisposableStack?.toString?.());
  attempt("taken apart", () => {
    const { DisposableStack: held } = globalThis;
    return typeof held;
  });
  attempt("taken apart with a default", () => {
    const { DisposableStack: held = "default" } = globalThis;
    return typeof held;
  });
}

// Often enough for whatever remembers the first answer.
for (let round = 0; round < 40; round++) {
  told.length = 0;
  ask();
}
console.log(told.join("\n"));
