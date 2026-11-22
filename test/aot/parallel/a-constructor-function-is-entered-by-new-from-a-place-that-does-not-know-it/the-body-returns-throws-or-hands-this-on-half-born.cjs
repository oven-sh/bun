const holder = { made: null }; globalThis.heldForWitness = holder;
function hidden(v) { holder.made = v; return Reflect.get(globalThis, "heldForWitness").made; }
function tried(f) { try { return f(); } catch (error) { return error.constructor.name + ":" + error.message.slice(0, 40); } }
function show(o) { return o === null || typeof o !== "object" ? typeof o + ":" + String(o) : Object.getPrototypeOf(o) === null ? "null-proto " + JSON.stringify(o) : (Object.getPrototypeOf(o).constructor && Object.getPrototypeOf(o).constructor.name) + " " + JSON.stringify(o) + " " + Reflect.ownKeys(o).map(String).join(); }
const seen = [];
function Returns(kind) { this.kind = kind; this.more = 1; if (kind === 1) return { other: true }; if (kind === 2) return 5; if (kind === 3) return null; if (kind === 4) return [1]; if (kind === 5) return function f() {}; if (kind === 6) return hidden(this); if (kind === 7) return hidden("text"); if (kind === 8) return tail(kind); }
function tail(k) { return k % 2 ? 1 : { tail: k }; }
const R = hidden(Returns); for (let k = 0; k < 9; k++) console.log(k, show(new R(k)));
function Throws(when) { this.a = 1; seen.push(this); if (when === 1) throw new Error("first"); this.b = 2; if (when === 2) throw new RangeError("second"); this.c = 3; }
const T = hidden(Throws); for (let k = 0; k < 3; k++) console.log(k, tried(() => show(new T(k))), show(seen[seen.length - 1]));
function look(o) { Bun.gc(true); const keys = Reflect.ownKeys(o).map(String).join(); o.extra = keys.length; seen.push(o); return keys + "/" + JSON.stringify(o) + "/" + ("b" in o) + "/" + String(o.b); }
function HalfBorn(a) { this.a = { held: a }; this.said = look(this); this.b = [a]; this.again = look(this); this.c = "c" + a; }
const B = hidden(HalfBorn); for (let k = 0; k < 3; k++) { const o = new B(k); Bun.gc(true); console.log(show(o), o.a.held, o.b[0]); }
function Deletes(a) { this.a = a; this.b = a; delete this.a; this.c = a; this.a = "again"; Object.defineProperty(this, "b", { get() { return "getter"; }, enumerable: true }); }
const D = hidden(Deletes); console.log(show(new D(1)), new D(2).b);
function Freezes(a) { this.a = a; Object.freeze(this); this.b = a; } const Z = hidden(Freezes); console.log(show(new Z(1)));
function Reenters(n) { this.n = n; this.inner = n > 0 ? new R2(n - 1) : null; this.done = true; } const R2 = hidden(Reenters); console.log(JSON.stringify(new R2(3)));
