// Object.freeze() of objects that hold nothing but fields, and of all that hold more: what may be written, deleted, defined and read behind it.
const show = v => (typeof v === "symbol" ? String(v) : typeof v === "function" ? "function" : v && typeof v === "object" ? JSON.stringify(v) : String(v));
const line = (...all) => console.log(all.map(show).join(" "));
const describe = o => Reflect.ownKeys(o).map(k => { const d = Object.getOwnPropertyDescriptor(o, k); return String(k) + ("value" in d ? "=" + show(d.value) + (d.writable ? "w" : "") : "a") + (d.enumerable ? "e" : "") + (d.configurable ? "c" : ""); }).join();
const strictly = f => { try { return f(); } catch (e) { return e.constructor.name; } };
function store(o, v) { o.a = v; return o.a; }
function storeNew(o, v) { o.fresh = v; return o.fresh; }
function storeByReflect(o, v) { return Reflect.set(o, "a", v) + ":" + Reflect.set(o, "other", v) + ":" + o.a; }
function remove(o) { return delete o.a; }
function look(name, o) {
  line(name, Object.isFrozen(o), Object.isSealed(o), Object.isExtensible(o), describe(o));
  line(strictly(() => store(o, 9)), strictly(() => storeNew(o, 9)), storeByReflect(o, 8), strictly(() => remove(o)), strictly(() => Object.defineProperty(o, "a", { value: 7 }).a), strictly(() => Object.setPrototypeOf(o, null) && 1), describe(o));
}
class Point { #secret = 3; constructor(a, b) { this.a = a; this.b = b; } get sum() { return this.a + this.b; } bump() { this.#secret++; return this.#secret; } }
class Deferred { a = 1; arrow = () => this.a; method() { return this.a; } }
const symbol = Symbol("s");
const makers = {
  fields: () => ({ a: 1, b: "x" }),
  empty: () => ({}),
  instance: () => new Point(1, 2),
  deferred: () => new Deferred(),
  symbol: () => ({ a: 1, [symbol]: 2 }),
  accessor: () => ({ a: 1, get b() { return 5; }, set b(v) { this.a = v; } }),
  defined: () => Object.defineProperty({ a: 1 }, "b", { value: 2, enumerable: false }),
  extra: () => { const o = { a: 1 }; o["k" + makers.count++ % 3] = 2; return o; },
  deleted: () => { const o = { a: 1, b: 2, c: 3 }; delete o.b; return o; },
  indexed: () => ({ a: 1, 0: "zero", 5: "five" }),
  sealed: () => Object.seal({ a: 1, b: 2 }),
  fixed: () => Object.preventExtensions({ a: 1, b: 2 }),
  twice: () => Object.freeze({ a: 1 }),
  created: () => Object.create({ a: 0, b: 0 }, { a: { value: 1, writable: true, enumerable: true, configurable: true } }),
  copied: () => ({ ...{ a: 1, b: 2 }, c: 3 }),
  spreadClass: () => Object.assign(new Point(3, 4), { c: 5 }),
};
makers.count = 0;
for (const name of Object.keys(makers)) {
  if (name === "count") continue;
  for (let round = 0; round < 3; round++) look(name + round, Object.freeze(makers[name]()));
}

// An object that others inherit from: what they store is refused behind the freeze.
const parent = { a: 1, b: 2 };
const child = Object.create(parent);
child.a = 5;
Object.freeze(parent);
line(strictly(() => { child.b = 6; return child.b; }), child.a, describe(child));
class Base { static a = 1; }
class Heir extends Base {}
Object.freeze(Base);
line(strictly(() => { Heir.a = 2; return Heir.a; }), strictly(() => { Base.a = 3; return Base.a; }), Object.isFrozen(Heir));

// Private fields and methods go on, loops read what is frozen in their middle.
const point = Object.freeze(new Point(1, 2));
line(point.bump(), point.bump(), point.sum, strictly(() => { point.a = 4; return point.a; }));
const deferred = Object.freeze(new Deferred());
line(deferred.arrow(), deferred.method(), deferred.arrow === deferred.arrow);
function loop(n) {
  const o = { a: 0, b: 0 };
  let failures = 0;
  for (let i = 0; i < n; i++) {
    if (i === 3) Object.freeze(o);
    try { o.a = o.a + 1; } catch { failures++; }
    try { o.b++; } catch { failures++; }
  }
  return [o.a, o.b, failures];
}
line(loop(2), loop(5), loop(9));
function elements(n) {
  const list = [];
  for (let i = 0; i < n; i++) {
    const props = { className: "c" + (i % 3), children: i };
    const element = { type: "div", key: null, props, owner: null };
    Object.freeze(element.props);
    Object.freeze(element);
    list.push(element);
  }
  return list.filter(e => Object.isFrozen(e) && Object.isFrozen(e.props)).length + ":" + list[n - 1].props.className + strictly(() => { list[0].props.children = 9; }) + strictly(() => { list[0].key = "k"; });
}
line(elements(3), elements(40));
