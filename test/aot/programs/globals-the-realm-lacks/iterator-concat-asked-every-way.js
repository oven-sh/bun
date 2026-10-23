// BUN_JSC_useIteratorSequencing=0 takes Iterator.concat away. Nothing here stores to it. Each way of asking for the member answers as a lookup in the realm of the run does.
const told = [];
// The wording of an error is the engine's or the compiler's, so only its name is told.
function attempt(what, action) {
  try {
    told.push(what + ": " + String(action()));
  } catch (error) {
    told.push(what + ": " + error.name);
  }
}

const key = ["co", "ncat"].join("");

function ask() {
  attempt("typeof", () => typeof Iterator.concat);
  attempt("typeof is function", () => typeof Iterator.concat === "function");
  attempt("typeof is undefined", () => (typeof Iterator.concat === "undefined" ? "absent" : "present"));
  attempt("truth", () => (Iterator.concat ? "with" : "without"));
  attempt("used behind a test", () => (Iterator.concat ? typeof Iterator.concat.name : "went around"));
  attempt("in", () => "concat" in Iterator);
  attempt("hasOwn", () => Object.hasOwn(Iterator, "concat"));
  attempt("by a key that is made", () => typeof Iterator[key]);
  attempt("call", () => typeof Iterator.concat([1], [2]));
  attempt("optional call", () => typeof Iterator.concat?.([1], [2]));
  attempt("taken apart", () => {
    const { concat: held } = Iterator;
    return [typeof held, typeof held].join();
  });
}

// Often enough for whatever remembers the first answer.
for (let round = 0; round < 40; round++) {
  told.length = 0;
  ask();
}
console.log(told.join("\n"));
