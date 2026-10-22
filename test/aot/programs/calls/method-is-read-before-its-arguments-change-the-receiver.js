// `o.m(f(o))` reads `m` before `f` runs. What `f` does to the receiver, also putting it back as it was made, does not change which function is called.
const unknown = new Function("value", "return value" + process.argv[0].slice(process.argv[0].length));
const lines = [];

class Plain { m(value) { return "Plain.m " + value; } get g() { return "Plain.g"; } }
const other = { m(value) { return "other.m " + value; }, get g() { return "other.g"; } };

function callWith(o, change) { return o.m(change(o)); }
function callTwice(o, change) { return o.m(change(o)) + ", " + o.m("after"); }

function restorePrototype(o) { Object.setPrototypeOf(o, Plain.prototype); return "restored"; }
function changePrototype(o) { Object.setPrototypeOf(o, other); return "changed"; }
function addOwn(o) { o.m = value => "own m " + value; return "added"; }
function deleteOwn(o) { delete o.m; return "deleted"; }
function nothing() { return "nothing"; }

function made(prepare) { const o = new Plain(); prepare(o); return o; }
const cases = [
  ["as made", nothing, nothing],
  ["another prototype, put back", changePrototype, restorePrototype],
  ["the prototype changes", nothing, changePrototype],
  ["an own method, deleted", addOwn, deleteOwn],
  ["an own method is added", nothing, addOwn],
  ["another prototype and an own method, both undone", o => { changePrototype(o); addOwn(o); }, o => { deleteOwn(o); return restorePrototype(o); }],
];
for (let round = 0; round < 3; round++) {
  for (const [label, prepare, change] of cases) {
    lines.push(label + ": " + callWith(made(prepare), change) + " | " + callTwice(made(prepare), change));
    lines.push(label + ", unknown receiver: " + callWith(unknown(made(prepare)), change) + " | " + callTwice(unknown(made(prepare)), change));
  }
}

// The read itself runs code that puts the receiver back.
const restoring = { get m() { Object.setPrototypeOf(this, Plain.prototype); return value => "from the getter " + value; } };
function callPlainly(o) { return o.m("x"); }
for (let round = 0; round < 3; round++) {
  const o = new Plain();
  lines.push("no getter: " + callPlainly(o) + ", " + callPlainly(unknown(o)));
  Object.setPrototypeOf(o, restoring);
  lines.push("a getter on the prototype restores it: " + callPlainly(o) + ", then " + callPlainly(o));
  const p = unknown(new Plain());
  Object.setPrototypeOf(p, restoring);
  lines.push("the same, unknown receiver: " + callPlainly(p) + ", then " + callPlainly(p));
  const q = new Plain();
  Object.defineProperty(q, "m", { configurable: true, get() { delete this.m; return value => "from the own getter " + value; } });
  lines.push("an own getter deletes itself: " + callPlainly(q) + ", then " + callPlainly(q));
  const r = unknown(new Plain());
  Object.defineProperty(r, "m", { configurable: true, get() { delete this.m; return value => "from the own getter " + value; } });
  lines.push("the same, unknown receiver: " + callPlainly(r) + ", then " + callPlainly(r));
}
console.log(lines.join("\n"));
