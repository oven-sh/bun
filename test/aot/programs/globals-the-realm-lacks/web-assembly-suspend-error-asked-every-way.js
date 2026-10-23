// BUN_JSC_useJSPI=0 takes WebAssembly.SuspendError away. Nothing here stores to it. Each way of asking for the member answers as a lookup in the realm of the run does.
const told = [];
// The wording of an error is the engine's or the compiler's, so only its name is told.
function attempt(what, action) {
  try {
    told.push(what + ": " + String(action()));
  } catch (error) {
    told.push(what + ": " + error.name);
  }
}

const key = ["Su", "spendError"].join("");

function ask() {
  attempt("typeof", () => typeof WebAssembly.SuspendError);
  attempt("typeof is function", () => typeof WebAssembly.SuspendError === "function");
  attempt("typeof is undefined", () => (typeof WebAssembly.SuspendError === "undefined" ? "absent" : "present"));
  attempt("truth", () => (WebAssembly.SuspendError ? "with" : "without"));
  attempt("used behind a test", () => (WebAssembly.SuspendError ? typeof WebAssembly.SuspendError.name : "went around"));
  attempt("in", () => "SuspendError" in WebAssembly);
  attempt("hasOwn", () => Object.hasOwn(WebAssembly, "SuspendError"));
  attempt("by a key that is made", () => typeof WebAssembly[key]);
  attempt("call", () => typeof new WebAssembly.SuspendError());
  attempt("optional call", () => typeof WebAssembly.SuspendError?.());
  attempt("taken apart", () => {
    const { SuspendError: held } = WebAssembly;
    return [typeof held, typeof held].join();
  });
}

// Often enough for whatever remembers the first answer.
for (let round = 0; round < 40; round++) {
  told.length = 0;
  ask();
}
console.log(told.join("\n"));
