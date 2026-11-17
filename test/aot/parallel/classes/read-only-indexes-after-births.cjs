// A read-only element on the prototype of a class below Array, after many births.
const log = [];
function one(v) { return typeof v === "function" ? "f" : String(v); }
function show(a) { let s = a.constructor.name + " " + a.length + ":"; for (let i = 0; i < a.length && i < 9; i++) s += (Object.hasOwn(a, i) ? "" : "!") + one(a[i]) + ","; return s + Object.keys(a).join(); }
function fill(a, n) { for (let i = 0; i < n; i++) try { a[i] = i; } catch (e) { log.push(i + " " + e.constructor.name); } return a; }
const accessor = (name) => ({ get() { return name + " got"; }, set(v) { log.push(name + " set " + v); }, configurable: true });
class Direct extends Array { constructor(n) { super(n); } }
class Held extends Array { constructor(n) { super(n); this.rows = n; this.columns = 2; } }
class Above extends Array { first() { return this[0]; } }
class Below extends Above { constructor(n) { super(n); this.held = n; } }
const mixin = (S) => class Mixed extends S { get cells() { return this.length; } };
class OfMixin extends mixin(Array) { constructor(n) { super(n); this.held = n; } }
class Apart extends Array { constructor(n) { super(n); this.apart = n; } }
const all = [Direct, Held, Below, OfMixin, Apart];
function births(count) { for (const C of all) for (let k = 0; k < count; k++) { const a = fill(new C(6), 6); if (k < 2 || k === count - 1) log.push(show(a)); } }
births(70); births(3);
for (const C of [Direct, Held, Below, OfMixin]) Object.defineProperty(C.prototype, 1, { value: "fixed " + C.name, writable: false, configurable: true });
births(3); births(70);
log.push(show(fill(Reflect.construct(Direct, [6], Held), 6)), show(fill(Reflect.construct(Array, [6], Direct), 6)), show(fill(Direct.from([1, 2, 3]), 5)), show(new Held(4).map((x, i) => i)), show(fill(new (class Later extends Direct {})(6), 6)));
console.log(log.length); console.log(log.join("\n"));
