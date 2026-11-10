// The alias and the key both arrive by flow.
function outer() {
  const g = globalThis;
  const key = Symbol.for("made.up");
  return () => g[key];
}
console.log(outer()());
