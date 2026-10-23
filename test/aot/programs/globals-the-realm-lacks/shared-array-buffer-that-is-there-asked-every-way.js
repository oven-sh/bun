// The global SharedArrayBuffer is there, as in every run without an option. Nothing here stores to the name. Each way of asking for it answers as a lookup in the realm of the run does.
const told = [];
// The wording of an error is the engine's or the compiler's, so only its name is told.
function attempt(what, action) {
  try {
    told.push(what + ": " + String(action()));
  } catch (error) {
    told.push(what + ": " + error.name);
  }
}

const key = ["Sha", "redArrayBuffer"].join("");

function ask() {
  attempt("typeof", () => typeof SharedArrayBuffer);
  attempt("typeof is not undefined", () => typeof SharedArrayBuffer !== "undefined");
  attempt("typeof is undefined", () => (typeof SharedArrayBuffer === "undefined" ? "absent" : "present"));
  attempt("typeof is the kind", () => typeof SharedArrayBuffer === "function");
  attempt("used behind typeof", () => (typeof SharedArrayBuffer !== "undefined" ? typeof SharedArrayBuffer.prototype : "went around"));
  attempt("bare read", () => SharedArrayBuffer === undefined);
  attempt("bare read that is kept", () => {
    const held = SharedArrayBuffer;
    return [typeof held, typeof held].join();
  });
  attempt("call", () => typeof SharedArrayBuffer());
  attempt("construction", () => typeof new SharedArrayBuffer(8));
  attempt("member", () => typeof SharedArrayBuffer.prototype);
  attempt("call of a member", () => typeof SharedArrayBuffer.toString());
  attempt("instanceof", () => ({}) instanceof SharedArrayBuffer);
  attempt("in", () => "SharedArrayBuffer" in globalThis);
  attempt("hasOwn", () => Object.hasOwn(globalThis, "SharedArrayBuffer"));
  attempt("descriptor", () => typeof Object.getOwnPropertyDescriptor(globalThis, "SharedArrayBuffer"));
  attempt("member of globalThis", () => typeof globalThis.SharedArrayBuffer);
  attempt("by a key that is written", () => typeof globalThis["SharedArrayBuffer"]);
  attempt("by a key that is made", () => typeof globalThis[key]);
  attempt("truth", () => (globalThis.SharedArrayBuffer ? "true" : "false"));
  attempt("not", () => !globalThis.SharedArrayBuffer);
  attempt("and", () => typeof (globalThis.SharedArrayBuffer && globalThis.SharedArrayBuffer.prototype));
  attempt("nothing else", () => typeof (globalThis.SharedArrayBuffer ?? "nothing"));
  attempt("optional member", () => typeof globalThis.SharedArrayBuffer?.prototype);
  attempt("optional call", () => typeof globalThis.SharedArrayBuffer?.());
  attempt("optional call of a member", () => typeof globalThis.SharedArrayBuffer?.toString?.());
  attempt("taken apart", () => {
    const { SharedArrayBuffer: held } = globalThis;
    return typeof held;
  });
  attempt("taken apart with a default", () => {
    const { SharedArrayBuffer: held = "default" } = globalThis;
    return typeof held;
  });
}

// Often enough for whatever remembers the first answer.
for (let round = 0; round < 40; round++) {
  told.length = 0;
  ask();
}
console.log(told.join("\n"));
