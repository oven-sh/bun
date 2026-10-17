// `Object.assign(this, values)` where the class has accessors or read-only members, or the instance has arrow functions as fields. A store consults the prototype chain: names that no prototype intercepts become own properties, a setter runs, a getter alone or a read-only member throws. The chain may change between two calls.
const lines = [];
function say(label, work) {
  let text;
  try {
    text = JSON.stringify(work());
  } catch (error) {
    text = "throws " + error.constructor.name;
  }
  lines.push(label + ": " + text);
}
const own = object => Object.keys(object).join();

class Store {
  constructor(values) {
    this.first = 1;
    this.fill(values);
  }
  fill(values) {
    Object.assign(this, values);
  }
  get state() {
    return "state of " + this.first;
  }
  set watched(value) {
    this.seen = (this.seen ?? "") + value;
  }
  get fixed() {
    return "fixed";
  }
}
class Derived extends Store {
  get more() {
    return "more";
  }
}

for (let turn = 0; turn < 4; turn++) {
  say("new names " + turn, () => { const s = new Store({ a: turn, b: "b", c: null, d: [turn] }); return [own(s), s.a, s.d, s.state]; });
  say("new names on a derived class " + turn, () => { const s = new Derived({ a: turn, b: "b" }); return [own(s), s.a, s.more, s.state]; });
  say("an own name is overwritten " + turn, () => { const s = new Store({ first: turn + 10, z: 1 }); return [own(s), s.state]; });
  say("a setter runs " + turn, () => { const s = new Store({ a: 1, watched: "w" + turn, b: 2 }); return [own(s), s.seen, Object.hasOwn(s, "watched")]; });
  say("a getter alone throws " + turn, () => new Store({ a: 1, fixed: 2, b: 3 }));
  say("what was stored before the throw stays " + turn, () => { const s = new Store({}); try { s.fill({ a: 1, state: 2, b: 3 }); } catch {} return own(s); });
}

say("many names go out of line", () => { const values = {}; for (let i = 0; i < 20; i++) values["k" + i] = i; const s = new Store(values); return [own(s), s.k19]; });
say("symbols and hidden names", () => { const key = Symbol("key"); const values = Object.defineProperty({ [key]: 1, shown: 2 }, "hidden", { value: 3, enumerable: false }); const s = new Store(values); return [own(s), s[key], s.hidden]; });
say("__proto__ as an own name of the source", () => { const s = new Store(JSON.parse('{"a":1,"__proto__":{"inherited":2}}')); return [own(s), s.inherited, s instanceof Store]; });
say("a getter on the source", () => { let reads = 0; const s = new Store({ a: 1, get b() { return ++reads; } }); return [own(s), s.b, reads]; });
say("a source that is an instance", () => { const s = new Store(new Store({ p: 1 })); return [own(s), s.p]; });
say("a frozen instance", () => Object.freeze(new Store({})).fill({ a: 1 }));
say("an instance that cannot be extended", () => Object.preventExtensions(new Store({})).fill({ a: 1 }));
say("an own read-only name", () => Object.defineProperty(new Store({}), "a", { value: 0, writable: false }).fill({ a: 1 }));
say("an own accessor", () => { let got; const s = Object.defineProperty(new Store({}), "a", { set(value) { got = value; }, configurable: true }); s.fill({ a: 7, b: 8 }); return [own(s), got]; });

class Changing {
  fill(values) {
    Object.assign(this, values);
    return this;
  }
  get state() {
    return "state";
  }
}
const values = () => ({ one: 1, two: 2 });
for (let turn = 0; turn < 3; turn++) say("before any change " + turn, () => own(new Changing().fill(values())));
let caught = [];
Object.defineProperty(Changing.prototype, "two", { set(value) { caught.push(value); }, configurable: true });
for (let turn = 0; turn < 2; turn++) say("a setter was added to the class " + turn, () => [own(new Changing().fill(values())), caught.length]);
delete Changing.prototype.two;
for (let turn = 0; turn < 2; turn++) say("and deleted " + turn, () => [own(new Changing().fill(values())), caught.length]);
Object.defineProperty(Changing.prototype, "one", { value: "read-only", writable: false, configurable: true });
say("a read-only member was added", () => own(new Changing().fill(values())));
delete Changing.prototype.one;
Changing.prototype.one = "plain data up there";
say("plain data on the class", () => { const c = new Changing().fill(values()); return [own(c), c.one]; });
const between = { set one(value) { caught.push("between " + value); } };
Object.setPrototypeOf(between, Object.getPrototypeOf(Changing.prototype));
delete Changing.prototype.one;
Object.setPrototypeOf(Changing.prototype, between);
say("another object was put into the chain", () => [own(new Changing().fill(values())), caught.at(-1)]);
Object.setPrototypeOf(Changing.prototype, new Proxy({}, { set(target, name, value, receiver) { caught.push("proxy " + String(name)); return Reflect.defineProperty(receiver, name, { value, writable: true, enumerable: true, configurable: true }); } }));
say("a proxy in the chain", () => [own(new Changing().fill(values())), caught.slice(-2)]);

class WithArrows {
  constructor(values) {
    this.count = 0;
    this.increment = () => ++this.count;
    this.reset = () => { this.count = 0; };
    Object.assign(this, values);
  }
}
for (let turn = 0; turn < 3; turn++) {
  say("arrow functions as fields " + turn, () => { const w = new WithArrows({ a: turn, b: 2 }); return [own(w), w.increment(), w.increment(), w.a]; });
  say("an arrow function is replaced " + turn, () => { const w = new WithArrows({ a: turn, increment: () => "replaced" }); return [own(w), w.increment(), typeof w.reset]; });
  say("an instance with arrow functions is the source " + turn, () => { const copy = Object.assign({}, new WithArrows({ a: turn })); return [own(copy), typeof copy.increment, copy.increment()]; });
}

function Old(values) {
  Object.assign(this, values);
}
Object.defineProperty(Old.prototype, "size", { get() { return Object.keys(this).length; }, configurable: true });
for (let turn = 0; turn < 3; turn++) say("a constructor function " + turn, () => { const o = new Old({ a: turn, b: 2 }); return [own(o), o.size]; });
say("a constructor function, intercepted", () => new Old({ a: 1, size: 2 }));
const parent = { get kind() { return "parent"; } };
for (let turn = 0; turn < 3; turn++) say("Object.create " + turn, () => { const o = Object.assign(Object.create(parent), { a: turn }, { b: 2 }); return [own(o), o.kind]; });
say("Object.create, intercepted", () => Object.assign(Object.create(parent), { a: 1 }, { kind: 2 }));

console.log(lines.join("\n"));
