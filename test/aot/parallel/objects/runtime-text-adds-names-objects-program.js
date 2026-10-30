// Text made at run time stores names that the program never wrote on objects the program's constructors, classes and literals made: few and many names, key order, objects that take no more, setters and read-only names above, collections in between.
const pad = process.argv.length > 99 ? " " : "";
const text = (...parts) => new Function(...parts.slice(0, -1), parts.at(-1) + pad);
const NullObject = function () {};
NullObject.prototype = Object.create(null);
class Point { constructor(x, y) { this.x = x; this.y = y; } sum() { return this.x + this.y; } }
class Empty {}
const show = object => JSON.stringify(object) + " " + Reflect.ownKeys(object).join();

const createParams = text("NullObject", "return function (values) { const params = new NullObject(); params['shop'] = values[0]; params['order'] = values[1]; return params; }")(NullObject);
console.log(show(createParams(["west", 7])), Object.getPrototypeOf(createParams([])) === NullObject.prototype, "shop" in createParams([]), createParams(["a"]).order);

const addThree = text("make", "const o = make(); o.first = 1; o.second = 'two'; o.third = [3]; return o");
for (const make of [() => new NullObject(), () => new Point(1, 2), () => new Empty(), () => ({ x: 1 }), () => ({}), () => Object.create(new Point(5, 6)), () => [], () => function () {}])
  console.log(show(addThree(make)));
console.log(addThree(() => new Point(1, 2)).sum(), addThree(() => new Point(1, 2)) instanceof Point);

const names = Array.from({ length: 40 }, (_, n) => "name" + n);
const addMany = text("make", "const o = make(); " + names.map((name, n) => `o.${name} = ${n};`).join(" ") + " return o");
for (const make of [() => new NullObject(), () => new Point(1, 2)]) {
  const made = addMany(make);
  console.log(Reflect.ownKeys(made).length, names.every((name, n) => made[name] === n), Object.keys(made).slice(-2).join());
}

const store = text("o", "v", "o.added = v; return o.added");
const strictStore = text("o", "v", "'use strict'; o.added = v; return o.added");
const attempts = {
  frozen: () => Object.freeze(new Point(1, 2)), sealed: () => Object.seal(new Point(1, 2)), closed: () => Object.preventExtensions(new NullObject()), closedWithOthers: () => { const o = new NullObject(); store(o, 0); delete o.added; o.other = 1; return Object.preventExtensions(o); },
  setterAbove: () => Object.create(Object.defineProperty(new Point(1, 2), "added", { set(v) { this.seen = v; }, get() { return "got " + this.seen; } })),
  readOnlyAbove: () => Object.create(Object.defineProperty(new Point(1, 2), "added", { value: "fixed", writable: false })),
  proxyAbove: () => Object.create(new Proxy({}, { set(target, key, value, receiver) { Object.defineProperty(receiver, key, { value: "through " + value, configurable: true, enumerable: true, writable: true }); return true; } })),
};
for (const [name, make] of Object.entries(attempts)) {
  const results = [];
  for (const way of [store, strictStore]) { const o = make(); try { results.push(String(way(o, 5)), show(o)); } catch (error) { results.push(error.constructor.name, show(o)); } }
  console.log(name, results.join(" | "));
}
class WithSetter { set added(v) { this.kept = v * 2; } get added() { return this.kept; } }
console.log(store(new WithSetter(), 4), show((o => (store(o, 4), o))(new WithSetter())));

const again = new NullObject();
for (let round = 0; round < 3; round++) { store(again, round); text("o", "o.b = 1; o.a = 2")(again); console.log(show(again)); delete again.added; delete again.b; }

const values = [undefined, null, true, 0, -0, 1.5, NaN, "s", Symbol.for("y"), 10n, {}, [], () => 1];
console.log(values.map(value => Object.is(store(new NullObject(), value), value)).join());

const kept = [];
const fill = text("NullObject", "kept", "n", "for (let i = 0; i < n; i++) { const o = new NullObject(); o.id = i; o.label = 'l' + i; o.list = [i]; if (i % 1000 === 0) kept.push(o); }");
fill(NullObject, kept, 200000);
Bun.gc(true);
console.log(kept.length, kept.every((o, n) => o.id === n * 1000 && o.label === "l" + o.id && o.list[0] === o.id));
const old = new NullObject();
Bun.gc(true);
text("o", "o.young = { deep: [1, 2, 3] }; o.younger = 'x'.repeat(3) + o.young.deep.length")(old);
Bun.gc(true);
console.log(show(old));
