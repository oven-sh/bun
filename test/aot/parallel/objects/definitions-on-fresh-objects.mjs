// Object.defineProperty() with a written descriptor on an object that the function has just made: the forms, the order of the keys, what runs behind it, what sees the object.
const show = v => (typeof v === "function" ? "f" : typeof v === "symbol" ? String(v) : v && typeof v === "object" ? "{" + Reflect.ownKeys(v).map(String).join() + "}" : Object.is(v, -0) ? "-0" : String(v));
const describe = o => Reflect.ownKeys(o).map(k => { const d = Object.getOwnPropertyDescriptor(o, k); return String(k) + ("value" in d ? "=" + show(d.value) + (d.writable ? "w" : "") : (d.get ? "g" : "") + (d.set ? "s" : "")) + (d.enumerable ? "e" : "") + (d.configurable ? "c" : ""); }).join(" ") + " " + Object.isExtensible(o) + Object.isFrozen(o);
const attempt = f => { try { return show(f()); } catch (e) { return e.constructor.name; } };
let seen = null;
const kept = [];
function warn() { seen = this; return "warned"; }

// As React makes an element for development.
function element(type, key, props, owner) {
  const ref = props.ref;
  const made = { $$typeof: "element", type, key, props, _owner: owner };
  null !== (void 0 !== ref ? ref : null) ? Object.defineProperty(made, "ref", { enumerable: false, get: warn }) : Object.defineProperty(made, "ref", { enumerable: false, value: null });
  made._store = {};
  Object.defineProperty(made._store, "validated", { configurable: false, enumerable: false, writable: true, value: 0 });
  Object.defineProperty(made, "_debugInfo", { configurable: false, enumerable: false, writable: true, value: null });
  Object.defineProperty(made, "_debugStack", { configurable: false, enumerable: false, writable: true, value: key });
  Object.freeze(made.props);
  Object.freeze(made);
  return made;
}
for (const props of [{}, { a: 1 }, { ref: null }, { ref: 5 }, { ref: undefined, b: 2 }]) {
  const made = element("div", props.a ?? null, props, 7);
  made._store.validated++;
  console.log(describe(made), describe(made._store), describe(made.props), Object.keys(made).join(), JSON.stringify(made), attempt(() => made.ref), attempt(() => { made.key = 1; }), attempt(() => { made._debugInfo = 1; }), attempt(() => { made._store.other = 1; return made._store; }), seen === made);
}

// Between definitions the object is read, copied, stored into, handed on and inherited from.
function between(p) {
  const o = { a: p };
  Object.defineProperty(o, "x", { value: p, writable: true });
  o.a++;
  const first = { ...o };
  Object.defineProperty(o, "y", { get() { seen = this; return this.a; }, configurable: true });
  seen = null;
  const read = o.y;
  if (seen === o) seen.a = 90;
  kept.push(o);
  Object.defineProperty(o, "z", { value: o, enumerable: true });
  kept[kept.length - 1].x = p + 1;
  return [describe(first), read, o.a, o.x, o.z === o, describe(o)].join("|");
}
console.log(between(1));
console.log(between("s"));

function inherited(p) {
  const o = { a: p };
  const child = Object.create(o);
  Object.defineProperty(o, "x", { value: p });
  const at = child.x;
  Object.defineProperty(o, "y", { get: warn });
  return [at, child.y, attempt(() => { child.x = 2; return child.x; }), seen === child, describe(o), describe(child)].join("|");
}
console.log(inherited(1), inherited(null));

function twice(p) {
  const o = { a: 1 };
  Object.defineProperty(o, "x", { value: 1, configurable: p > 0, writable: p > 1 });
  const again = attempt(() => Object.defineProperty(o, "x", { value: 2 }).x);
  Object.preventExtensions(o);
  return again + attempt(() => Object.defineProperty(o, "y", { value: 2 }).y) + describe(o);
}
for (let p = 0; p < 3; p++) console.log(twice(p));

class Noted {
  constructor(p) {
    this.a = p;
    Object.defineProperty(this, "hidden", { value: p, writable: true });
    if (p > 1) Object.defineProperty(this, "either", { value: p });
    else Object.defineProperty(this, "either", { get: warn });
    this.last = this.hidden;
  }
}
for (let p = 0; p < 4; p++) { const noted = new Noted(p); noted.hidden++; console.log(describe(noted), attempt(() => noted.either), noted.hidden, JSON.stringify(noted), attempt(() => { noted.either = 1; })); }

function inLoop(n) {
  const all = [];
  for (let i = 0; i < n; i++) {
    const o = { i };
    Object.defineProperty(o, "even", i % 2 ? { value: false } : { value: true, enumerable: true });
    Object.defineProperty(o, "square", { value: i * i, enumerable: true });
    all.push(o);
  }
  return all.map(o => JSON.stringify(o) + o.even + o.square).join();
}
console.log(inLoop(5));

// What a join brings is, but for a rare way, one kind of object.
function joined(holder, p) {
  holder.slot = {};
  Object.defineProperty(holder.slot, "v", { value: p, writable: true });
  return describe(holder.slot) + (holder.slot.v === p);
}
const accessors = { get slot() { return this.held; }, set slot(v) { this.held = p => p; } };
console.log(joined({ a: 1 }, 1), joined({ slot: 3 }, 2), attempt(() => joined(Object.freeze({ slot: 3 }), 2)), attempt(() => joined(Object.freeze({ slot: { w: 1 } }), 2)), joined(accessors, 4), joined(Object.create(accessors), 5), joined(new Proxy({}, {}), 6), joined([], 7));
for (const o of kept) console.log(describe(o));
