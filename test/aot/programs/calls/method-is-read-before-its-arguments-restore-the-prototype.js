// `o.m(f(o))` reads `m` while `o` has another prototype; `f` puts the prototype of the class back. Nothing in this program adds a property to such an object.
const lines = [];
class Plain { m(value) { return "Plain.m " + value; } }
const other = { m(value) { return "other.m " + value; } };
function restorePrototype(o) { Object.setPrototypeOf(o, Plain.prototype); return "restored"; }
function nothing() { return "nothing"; }
function callWith(o, change) { return o.m(change(o)); }
for (let round = 0; round < 4; round++) {
  lines.push(callWith(new Plain(), nothing));
  const o = new Plain();
  Object.setPrototypeOf(o, other);
  lines.push(callWith(o, restorePrototype) + ", then " + callWith(o, nothing));
}
const restoring = { get m() { Object.setPrototypeOf(this, Plain.prototype); return value => "from the getter " + value; } };
function callPlainly(o) { return o.m("x"); }
for (let round = 0; round < 4; round++) {
  const o = new Plain();
  lines.push(callPlainly(o));
  Object.setPrototypeOf(o, restoring);
  lines.push(callPlainly(o) + ", then " + callPlainly(o));
}
console.log(lines.join("\n"));
