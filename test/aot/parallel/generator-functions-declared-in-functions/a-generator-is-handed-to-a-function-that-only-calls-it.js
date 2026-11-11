// the road of names_handed_to_declarations (expressions.rs:387): `run(gen)` is no look while `made` is only called. plain: true true
const n = +process.argv[2] || 3;
const above = made => Object.getPrototypeOf(made);
function f() {
  "use strict";
  function* gen() { yield n; }
  function run(made) { return made(); }
  function pass(made) { return run(made); }
  const a = () => run(gen), b = () => pass(gen), c = () => gen();
  return String(above(a()) === above(b())) + " " + String(above(b()) === above(c()));
}
console.log(f());
