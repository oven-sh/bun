// instanceof, isPrototypeOf, links that are changed afterwards, in loops long enough for the compiled fast paths.
const lines = [];
const attempt = (run) => { try { return String(run()); } catch (error) { return error.constructor.name; } };
class Base { constructor() { this.b = 1; } kind() { return "base"; } }
class Other { constructor() { this.o = 2; } kind() { return "other"; } }
const Layer = (Parent) => class extends Parent { constructor() { super(); this.layer = 3; } kind() { return "layer>" + super.kind(); } static kindOf(o) { return o.kind(); } get sum() { return this.layer + (this.b ?? 0) + (this.o ?? 0); } };
class A extends Layer(Base) { }
class B extends Layer(Base) { }
class C extends Layer(Other) { }
const LA = Object.getPrototypeOf(A), LB = Object.getPrototypeOf(B), LC = Object.getPrototypeOf(C);
const all = [A, B, C, LA, LB, LC, Base, Other];
function table() { return all.map((Made) => { const o = attempt(() => new Made()); if (typeof o === "string" && !o.startsWith("[object")) return o; const made = new Made(); return all.map((Asked) => (made instanceof Asked ? 1 : 0)).join("") + all.map((Asked) => (Asked.prototype.isPrototypeOf(made) ? 1 : 0)).join("") + made.kind() + (made.sum ?? "-"); }).join(" "); }
lines.push(table());
function hot() { let n = 0; for (let i = 0; i < 3000; i++) { const a = new A(), b = new B(), c = new C(); n += (a instanceof LA ? 1 : 0) + (a instanceof LB ? 10 : 0) + (b instanceof LB ? 1 : 0) + (b instanceof LA ? 10 : 0) + (c instanceof LC ? 1 : 0) + (c instanceof Base ? 10 : 0) + a.sum + b.sum + c.sum + a.kind().length + c.kind().length; } return n; }
lines.push(String(hot()));
Object.setPrototypeOf(LA, Other); lines.push("class link of LA", table(), String(hot()));
Object.setPrototypeOf(LA.prototype, Other.prototype); lines.push("prototype link of LA", table(), String(hot()));
Object.setPrototypeOf(B, LC); Object.setPrototypeOf(B.prototype, LC.prototype); lines.push("B below LC", table(), String(hot()));
LB.prototype.kind = function () { return "replaced"; }; lines.push("LB.kind", table(), String(hot()));
Object.defineProperty(LC.prototype, "sum", { get() { return 1000; } }); lines.push("LC.sum", table(), String(hot()));
Object.defineProperty(LC.prototype, "layer", { set(v) { lines.push("setter ran"); }, get() { return -1; }, configurable: true }); lines.push("LC.layer", attempt(() => Object.keys(new C()).join("/")), attempt(() => Object.keys(new A()).join("/")), attempt(() => new C().layer));
delete LC.prototype.layer; lines.push(table());
Object.setPrototypeOf(LC, null); lines.push("LC below null", attempt(() => new C()), attempt(() => new A().kind()));
Object.setPrototypeOf(LC, function () { return { from: "a function" }; }); lines.push(attempt(() => JSON.stringify(new C())), attempt(() => new C() instanceof C));
console.log(lines.join("\n"));
