// Flags: --aot-check=verify-each-pass
// One parameter holds a class at one call and a built-in object that is no function at the other. The call that passes the class goes to a copy of the callee for functions.
function note(v) { console.log(typeof v); }
function is(v) { return typeof v === "function"; }
class Kind { tag = "c"; }
let held;
function sort(value) {
  note(Reflect.has(Object(value), "push") ? Promise.resolve(value) : typeof value !== "object" ? new Array(3).fill(value) : Array.from({ length: 2 }, () => value));
  if (is(value)) { held = value; }
  return "end";
}
note(sort((function* () { yield Array.prototype; })().next().value));
note(sort(new Map([["k", Kind]]).get("k")));
console.log(typeof held);
