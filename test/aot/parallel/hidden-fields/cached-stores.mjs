const attempt = f => { try { return f(); } catch (e) { return e.name; } };
class C { constructor(x) { if (x & 1) this.early = x; Object.defineProperty(this, "hidden", { value: x, writable: true }); Object.defineProperty(this, "kept", { value: x, writable: true, configurable: true }); Object.defineProperty(this, "fixed", { value: x }); Object.defineProperty(this, "seen", { value: x, enumerable: true, writable: true }); } }
const list = Array.from({ length: 8 }, (_, k) => new C(k));
function turn(o, i) { o.hidden = i; o.kept = i * 2; o.seen = i; let fails = 0; try { o.fixed = i; } catch { fails = 1; } return o.hidden + o.kept + o.seen + o.fixed + fails; }
let s = 0; for (let i = 0; i < 800; i++) s = (s + turn(list[i & 7], i)) | 0;
console.log("turns", s, list.map(o => Object.keys(o).join("+")).join(" "), JSON.stringify(Object.getOwnPropertyDescriptors(list[1])));
function keyed(o, k, v) { o[k] = v; return o[k]; }
for (let i = 0; i < 400; i++) s = (s + keyed(list[i & 7], ["hidden", "kept", "seen"][i % 3], i)) | 0;
console.log("keyed", s);
function values(o, v) { o.hidden = v; o.kept = v; return String(o.hidden) + typeof o.kept; }
for (const v of [1, 1.5, -0, "t", null, undefined, true, {}, [], Symbol.iterator, 10n, 2 ** 40]) console.log(attempt(() => values(list[2], v)), JSON.stringify(Object.keys(list[2])));
function store(o, v) { "use strict"; o.hidden = v; return o.hidden; }
const frozen = Object.freeze(new C(1)), sealed = Object.seal(new C(2)), closed = Object.preventExtensions(new C(3)), below = Object.create(new C(4)), proxy = new Proxy(new C(5), {}), made = Object.create(C.prototype), moved = Object.setPrototypeOf(new C(6), { set hidden(v) { this.m = v; } });
for (let i = 0; i < 40; i++) for (const o of [frozen, sealed, closed, below, proxy, made, moved]) attempt(() => store(o, i));
console.log("odd", [frozen, sealed, closed, below, proxy, made, moved].map(o => [attempt(() => store(o, 99)), o.hidden, Object.keys(o).join("+"), JSON.stringify(Object.getOwnPropertyDescriptor(o, "hidden"))].join(" ")).join(" | "));
Object.defineProperty(list[0], "hidden", { writable: false });
Object.defineProperty(list[1], "kept", { enumerable: true });
Object.defineProperty(list[2], "kept", { get() { return "g"; }, set(v) { this.early = v; }, configurable: true });
delete list[3].kept;
for (let i = 0; i < 80; i++) attempt(() => { const o = list[i & 7]; o.kept = i; store(o, i); });
console.log("after", list.map(o => [o.hidden, o.kept, Object.keys(o).join("+")].join(" ")).join(" | "));
class Late { constructor(x) { this.a = x; } hide() { this.h = 1; Object.defineProperty(this, "h", { enumerable: false }); return this; } first(v) { this.h = v; return this; } }
const lates = [new Late(1).hide(), new Late(2).first(3), new Late(4)];
for (let i = 0; i < 90; i++) { const o = lates[i % 3]; o.h = i; s += o.h; }
console.log("late", s, lates.map(o => Object.keys(o).join("+")).join(" "));
class Heir extends C { constructor(x) { super(x); this.own = 1; this.hidden = 5; } }
const heirs = [new Heir(1), new C(2), new Heir(3)]; for (let i = 0; i < 90; i++) s += turn(heirs[i % 3], i);
console.log("heirs", s, heirs.map(o => Object.keys(o).join("+")).join(" "));
class Before { constructor(x) { this.hidden = x; Object.defineProperty(this, "hidden", { enumerable: false }); } }
const before = [new Before(1), new Before(2)]; for (let i = 0; i < 60; i++) { before[i & 1].hidden = i; s += before[i & 1].hidden; } console.log("before", s, Object.keys(before[0]).length, JSON.stringify(Object.getOwnPropertyDescriptor(before[1], "hidden")));
console.log("reflect", Reflect.set(list[4], "hidden", 5), Reflect.set(list[4], "hidden", 6, list[5]), list[4].hidden, list[5].hidden, Reflect.set(list[0], "hidden", 7), Object.assign(list[6], { hidden: 8, kept: 9 }).hidden, { ...list[6] }.hidden);
