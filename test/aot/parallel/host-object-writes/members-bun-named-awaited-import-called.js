// Bun is in unknown hands and may have been written to. Functions that the program names only on `await import("bun")` are not called where they are read: they go through call, apply, bind, Reflect.apply, and to a built-in as a callback.
console.log(Reflect.set(Bun, "color", 1, {}));
function attempt(label, run) {
  try {
    console.log(label, String(run()));
  } catch (error) {
    console.log(label, "THROWS", String(error.message).slice(0, 60));
  }
}
const { peek, nanoseconds } = await import("bun");
attempt("call", () => peek.call(undefined, 1));
attempt("apply", () => typeof nanoseconds.apply(undefined, []));
const bun = await import("bun");
attempt("bind", () => typeof bun.which.bind(undefined, "a-program-that-is-not-there")());
attempt("Reflect.apply", () => Reflect.apply(bun.sleepSync, undefined, [0]));
attempt("a callback", () => [[1]].every(bun.deepEquals));
async function later() {
  const inside = await import("bun");
  return inside.randomUUIDv7.call(undefined).length;
}
attempt("in an async function", await later().then(length => () => length, error => () => { throw error; }));
