// BUN_JSC_useJointIteration=0 takes Iterator.zipKeyed away. Nothing here stores to it. Each way of asking for the member answers as a lookup in the realm of the run does.
const told = [];
// The wording of an error is the engine's or the compiler's, so only its name is told.
function attempt(what, action) {
  try {
    told.push(what + ": " + String(action()));
  } catch (error) {
    told.push(what + ": " + error.name);
  }
}

const key = ["zi", "pKeyed"].join("");

function ask() {
  attempt("typeof", () => typeof Iterator.zipKeyed);
  attempt("typeof is function", () => typeof Iterator.zipKeyed === "function");
  attempt("typeof is undefined", () => (typeof Iterator.zipKeyed === "undefined" ? "absent" : "present"));
  attempt("truth", () => (Iterator.zipKeyed ? "with" : "without"));
  attempt("used behind a test", () => {
    if (!Iterator.zipKeyed) return "went around";
    return typeof Iterator.zipKeyed.name;
  });
  attempt("in", () => "zipKeyed" in Iterator);
  attempt("hasOwn", () => Object.hasOwn(Iterator, "zipKeyed"));
  attempt("by a key that is made", () => typeof Iterator[key]);
  attempt("call", () => typeof Iterator.zipKeyed({ a: [1] }));
  attempt("optional call", () => typeof Iterator.zipKeyed?.({ a: [1] }));
  attempt("taken apart", () => {
    const { zipKeyed: held } = Iterator;
    return [typeof held, typeof held].join();
  });
}

// Often enough for whatever remembers the first answer.
for (let round = 0; round < 40; round++) {
  told.length = 0;
  ask();
}
console.log(told.join("\n"));
