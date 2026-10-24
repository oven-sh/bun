// BUN_JSC_useIteratorChunking=0 takes Iterator.prototype.windows away. Nothing here stores to it. Each way of asking for the member answers as a lookup in the realm of the run does.
const told = [];
// The wording of an error is the engine's or the compiler's, so only its name is told.
function attempt(what, action) {
  try {
    told.push(what + ": " + String(action()));
  } catch (error) {
    told.push(what + ": " + error.name);
  }
}

const key = ["wi", "ndows"].join("");

function ask() {
  attempt("typeof", () => typeof Iterator.prototype.windows);
  attempt("typeof is function", () => typeof Iterator.prototype.windows === "function");
  attempt("typeof is undefined", () => (typeof Iterator.prototype.windows === "undefined" ? "absent" : "present"));
  attempt("truth", () => (Iterator.prototype.windows ? "with" : "without"));
  attempt("used behind a test", () => {
    if (!Iterator.prototype.windows) return "went around";
    return typeof Iterator.prototype.windows.name;
  });
  attempt("in", () => "windows" in Iterator.prototype);
  attempt("hasOwn", () => Object.hasOwn(Iterator.prototype, "windows"));
  attempt("by a key that is made", () => typeof Iterator.prototype[key]);
  attempt("call", () => typeof [1, 2, 3].values().windows(2));
  attempt("optional call", () => typeof [1, 2, 3].values().windows?.(2));
  attempt("taken apart", () => {
    const { windows: held } = Iterator.prototype;
    return [typeof held, typeof held].join();
  });
}

// Often enough for whatever remembers the first answer.
for (let round = 0; round < 40; round++) {
  told.length = 0;
  ask();
}
console.log(told.join("\n"));
