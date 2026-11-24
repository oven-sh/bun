// A getter that Object.defineProperty lays on a record: read by name and by key, listed, copied, taken out of its descriptor, shadowed, and handed to code that nobody sees.
const out = [];
const log = (...values) => out.push(values.join(" "));
const show = run => { try { const v = run(); return typeof v === "function" ? "function " + v.name : typeof v === "symbol" ? String(v) : typeof v === "object" && v ? JSON.stringify(v) : String(v); } catch (error) { return error.constructor.name; } };
let unknown = v => v;
globalThis.hook && (unknown = globalThis.hook);
class Point {
  constructor(x, y) { this._x = x; this._y = y; }
  get x() { return this._x; }
  add(o) { return new Point(this._x + o._x, this._y + o._y); }
}
const names = {};
let count = 0, late;
const list = [1, , 3];
Object.defineProperty(names, "Point", { enumerable: true, get: () => Point });
Object.defineProperty(names, "count", { enumerable: true, configurable: true, get: () => count++ });
Object.defineProperty(names, "list", { enumerable: true, get: function () { return list; } });
Object.defineProperty(names, "later", { enumerable: true, get: () => late });
Object.defineProperty(names, "own", { enumerable: true, get: function () { return this === names; } });
Object.defineProperty(names, "given", { enumerable: true, get: (...rest) => rest.length });
Object.defineProperty(names, "hidden", { get: () => -0 });
Object.defineProperty(names, "throws", { get: () => { throw new RangeError("in getter"); } });
Object.defineProperty(names, "dead", { get: () => dead });
log(show(() => names[unknown("list")]), show(() => names[unknown("dead")]), show(() => names.dead));
const dead = NaN;
let sum = new Point(0, 0);
for (let i = 0; i < 1000; i++) sum = sum.add(new names.Point(i, 1));
log(sum.x, sum._y);
late = "now";
log(names.count, names.count, show(() => names[unknown("count")]), names.later, names.own, names.given, Object.is(names.hidden, -0), show(() => names.throws), names.dead);
log(show(() => JSON.stringify(names)), Object.keys(names).join());
for (const key in names) log(key, show(() => names[key]));
const copy = { ...names };
log(Object.keys(copy).join(), copy.own, show(() => new copy.Point(5, 6).add(new Point(1, 1)).x));
const taken = Object.getOwnPropertyDescriptor(names, "Point");
log(taken.set, taken.enumerable, taken.configurable, new (taken.get())(7, 8).x, taken.get.call(5, 6) === Point);
log(Object.getOwnPropertyDescriptor(names, "own").get.call(copy), Object.getOwnPropertyDescriptor(names, "given").get(1, 2, 3));
const below = Object.create(names);
log(below.own, show(() => below.list), show(() => { below.list = 1; return below.list; }), Reflect.get(names, "own", below));
log(show(() => Object.defineProperty(names, "Point", { value: 1 })), show(() => { Object.defineProperty(names, "count", { value: "data" }); return names.count; }));
log(new Proxy(names, {}).later, show(() => { class Heir extends names.Point {} return new Heir(3, 4).add(new Point(1, 1)).x; }));
const given = { odd: 1 };
Object.defineProperty(unknown(given), "odd", { get: () => [sum] });
log(show(() => given.odd[0].x), show(() => given[unknown("odd")].length));
globalThis.kept = names;
log(globalThis.kept.later, show(() => new globalThis.kept.Point(1, 2).add(sum).x));
console.log(out.join("\n"));
