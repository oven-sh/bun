const attempt = f => { try { return f(); } catch (e) { return e.name; } };
class C { constructor(x) { this._x = x; } put(v) { this.x = v; return this; } late(v) { this.z = v; return this; } }
const descriptor = { get() { return this._x * 2; }, set(v) { this._x = v; }, configurable: true, enumerable: false };
Object.defineProperty(C.prototype, "x", descriptor);
const list = Array.from({ length: 6 }, (_, k) => new C(k));
list[3].late(1); list[4].late(undefined); Object.defineProperty(list[5], "x", { value: 100, writable: true, configurable: true });
function turn(o, i) { o.x = i; return o.x; }
let s = 0; for (let i = 0; i < 600; i++) s = (s * 3 + turn(list[i % 6], i)) | 0;
console.log("turns", s, list.map(o => o.x).join(), list.map(o => Object.keys(o).join("+")).join(" "));
function read(o) { return o.x; }
Object.defineProperty(C.prototype, "x", { get() { return -this._x; }, set(v) { this._x = v + 1; }, configurable: true });
s = 0; for (let i = 0; i < 300; i++) s = (s + read(list[i % 6])) | 0;
console.log("other getter", s);
Object.defineProperty(C.prototype, "x", { get: undefined, set(v) { this._x = v; }, configurable: true });
s = 0; for (let i = 0; i < 60; i++) s += read(list[i % 5]) === undefined ? 1 : 0;
console.log("no getter", s);
Object.defineProperty(C.prototype, "x", { value: "data", writable: true, configurable: true });
s = ""; for (let i = 0; i < 12; i++) s += read(list[i % 6]);
console.log("data", s); list[0].x = "own"; console.log(read(list[0]), Object.keys(list[0]).join());
delete C.prototype.x;
console.log("deleted", list.map(o => read(o)).join());
Object.defineProperty(Object.getPrototypeOf(C.prototype) === Object.prototype ? C.prototype : C, "x", descriptor);
const moved = Object.setPrototypeOf(new C(9), { get x() { return "moved"; }, set x(v) { this.m = v; } });
const bare = Object.setPrototypeOf(new C(8), null);
const frozen = Object.freeze(new C(7)), sealed = Object.seal(new C(6)), closed = Object.preventExtensions(new C(5));
const proxy = new Proxy(new C(4), {}); const below = Object.create(new C(3));
for (let i = 0; i < 40; i++) { for (const o of [moved, frozen, sealed, closed, proxy, below]) attempt(() => turn(o, i)); }
console.log("odd", [moved, bare, frozen, sealed, closed, proxy, below].map(o => attempt(() => read(o))).join(), moved.m, Object.keys(below).join());
class D extends C { put(v) { this.x = v; return this; } }
Object.defineProperty(D.prototype, "x", { get() { return "D" + super_(this); }, configurable: true });
function super_(o) { return Reflect.get(C.prototype, "x", o); }
const ds = [new D(1), new C(2), new D(3)]; s = ""; for (let i = 0; i < 30; i++) s += attempt(() => turn(ds[i % 3], i));
console.log("heir", s.length, s.slice(0, 30));
class Thrower { constructor() { this.n = 0; } put(v) { this.t = v; } }
Object.defineProperty(Thrower.prototype, "t", { get() { if (this.n++ > 50) throw new RangeError("t"); return this.n; }, set(v) { this.n = v; } });
const t = new Thrower(); s = 0; for (let i = 0; i < 60; i++) { const a = attempt(() => t.t); s += a === "RangeError" ? 1000 : a; }
console.log("throws", s);
class Adds { constructor() { this.k = 1; } put(v) { this.q = v; } }
Object.defineProperty(Adds.prototype, "q", { get() { if (!this.seen) this.seen = 1; return Object.keys(this).length; }, set(v) { Object.defineProperty(this, "q", { value: v, writable: true, configurable: true, enumerable: true }); } });
const adds = Array.from({ length: 4 }, () => new Adds()); s = 0; for (let i = 0; i < 40; i++) s += adds[i & 3].q; adds[1].q = 5; for (let i = 0; i < 40; i++) s += adds[i & 3].q;
console.log("adds", s, Object.keys(adds[1]).join());
console.log("in", "x" in list[1], Object.hasOwn(list[1], "x"), list[1].hasOwnProperty("x"), Reflect.get(list[1], "x"), list[1]["x"]);
