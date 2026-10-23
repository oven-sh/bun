// BUN_JSC_useJSPI=0 takes WebAssembly.Suspending away. Nothing here stores to it. Each way of asking for the member answers as a lookup in the realm of the run does.
const told = [];
// The wording of an error is the engine's or the compiler's, so only its name is told.
function attempt(what, action) {
  try {
    told.push(what + ": " + String(action()));
  } catch (error) {
    told.push(what + ": " + error.name);
  }
}

const key = ["Su", "spending"].join("");

function ask() {
  attempt("typeof", () => typeof WebAssembly.Suspending);
  attempt("typeof is function", () => typeof WebAssembly.Suspending === "function");
  attempt("typeof is undefined", () => (typeof WebAssembly.Suspending === "undefined" ? "absent" : "present"));
  attempt("truth", () => (WebAssembly.Suspending ? "with" : "without"));
  attempt("used behind a test", () => {
    if (!WebAssembly.Suspending) return "went around";
    return typeof WebAssembly.Suspending.name;
  });
  attempt("in", () => "Suspending" in WebAssembly);
  attempt("hasOwn", () => Object.hasOwn(WebAssembly, "Suspending"));
  attempt("by a key that is made", () => typeof WebAssembly[key]);
  attempt("call", () => typeof new WebAssembly.Suspending(() => 1));
  attempt("optional call", () => typeof WebAssembly.Suspending?.(() => 1));
  attempt("taken apart", () => {
    const { Suspending: held } = WebAssembly;
    return [typeof held, typeof held].join();
  });
}

// Often enough for whatever remembers the first answer.
for (let round = 0; round < 40; round++) {
  told.length = 0;
  ask();
}
console.log(told.join("\n"));
