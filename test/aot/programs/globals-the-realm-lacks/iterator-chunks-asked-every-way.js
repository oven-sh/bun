// BUN_JSC_useIteratorChunking=0 takes Iterator.prototype.chunks away. Nothing here stores to it. Each way of asking for the member answers as a lookup in the realm of the run does.
const told = [];
// The wording of an error is the engine's or the compiler's, so only its name is told.
function attempt(what, action) {
  try {
    told.push(what + ": " + String(action()));
  } catch (error) {
    told.push(what + ": " + error.name);
  }
}

const key = ["ch", "unks"].join("");

function ask() {
  attempt("typeof", () => typeof Iterator.prototype.chunks);
  attempt("typeof is function", () => typeof Iterator.prototype.chunks === "function");
  attempt("typeof is undefined", () => (typeof Iterator.prototype.chunks === "undefined" ? "absent" : "present"));
  attempt("truth", () => (Iterator.prototype.chunks ? "with" : "without"));
  attempt("used behind a test", () => (Iterator.prototype.chunks ? typeof Iterator.prototype.chunks.name : "went around"));
  attempt("in", () => "chunks" in Iterator.prototype);
  attempt("hasOwn", () => Object.hasOwn(Iterator.prototype, "chunks"));
  attempt("by a key that is made", () => typeof Iterator.prototype[key]);
  attempt("call", () => typeof [1, 2, 3].values().chunks(2));
  attempt("optional call", () => typeof [1, 2, 3].values().chunks?.(2));
  attempt("taken apart", () => {
    const { chunks: held } = Iterator.prototype;
    return [typeof held, typeof held].join();
  });
}

// Often enough for whatever remembers the first answer.
for (let round = 0; round < 40; round++) {
  told.length = 0;
  ask();
}
console.log(told.join("\n"));
