// `o.#x` and `const [a] = v` where the value is null or undefined: the engine's own C++ refuses the value, and the message quotes what is written at the place.
class Holder {
  #x = 1;
  static read(o) { return [o.#x]; }
  static write(o) { o.#x = 2; return [o]; }
  static deep(o) { return [o.inner.#x]; }
  static has(o) { return [#x in o]; }
}
function flat(v) { const [x] = v; return [x]; }
function two(v) { const [a, b] = v; return [a, b]; }
function underName(v) { const { p: [x] } = v; return [x]; }
function second(v) { const [a, [x]] = v; return [a, x]; }
function assigned(v) { let x; [[x]] = v; return [x]; }
function parameter([x]) { return [x]; }
function walked(v) { const seen = []; for (const x of v) seen.push(x); return seen; }
function show(name, run) {
  try {
    console.log(name, "returned", JSON.stringify(run()));
  } catch (error) {
    console.log(name + ":", error.name + ": " + error.message);
  }
}
// An executable keeps the text of a function that something may ask for it.
globalThis.kept = { Holder, flat, two, underName, second, assigned, parameter, walked, show };

for (const nothing of [null, undefined]) {
  show("a private name is read", () => [Holder.read(nothing)]);
  show("a private name is stored", () => [Holder.write(nothing)]);
  show("a private name behind a path", () => [Holder.deep({ inner: nothing })]);
  show("a list", () => [flat(nothing)]);
  show("a list of two", () => [two(nothing)]);
  show("a list under a name", () => [underName({ p: nothing })]);
  show("the outer of two lists", () => [second(nothing)]);
  show("the inner of two lists", () => [second([1, nothing])]);
  show("lists that are assigned to, the outer", () => [assigned(nothing)]);
  show("lists that are assigned to, the inner", () => [assigned([nothing])]);
  show("a list as a parameter", () => [parameter(nothing)]);
  show("a loop", () => [walked(nothing)]);
}
show("a private name is asked for", () => [Holder.has(null)]);
show("a list of a number", () => [flat(1)]);
show("nothing is wrong", () => [Holder.read(new Holder()), flat([1]), second([1, [2]]), walked([3])]);
