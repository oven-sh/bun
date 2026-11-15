// No "use strict": functions that construct store on a `this` that is converted first. Called with new, without, by call and apply, on primitives, with setters above, leaving early, returning others.
const out = [], say = f => { try { out.push(String(f())); } catch (e) { out.push(e.name); } };
function P(x, y) { this.x = x; this.y = y; } function sum(p) { let s = 0; for (let i = 0; i < 12; i++) { s += p.x * 2 + p.y; p.x = s & 7; } return s; }
for (let i = 0; i < 40; i++) { say(() => sum(new P(i, i + 0.5))); say(() => sum(new P(i & 1 ? "t" : 1, i % 5 ? 2 : undefined))); }
function Early(x) { out.push(typeof this.x); this.x = x; out.push(typeof this.x); this.y = this.x + 1; } for (let i = 0; i < 6; i++) say(() => sum(new Early(i)));
let seen; function Leaks(x) { seen = this; look(); this.x = x; look(); this.y = 1; } function look() { out.push(String(seen.x) + String(seen.y)); } for (let i = 0; i < 6; i++) say(() => sum(new Leaks(i)));
function Some(x) { if (x & 1) this.x = x; this.y = 2; } for (let i = 0; i < 8; i++) say(() => sum(new Some(i)));
function Other(x) { this.x = 1; this.y = 1; if (x & 1) return { x: 9, y: 9 }; if (x & 2) return 5; } for (let i = 0; i < 8; i++) say(() => sum(new Other(i)));
function Set1(x) { this.x = x; this.y = 3; } let calls = 0; Object.defineProperty(Set1.prototype, "x", { set(v) { calls += v; }, get() { return 4; }, configurable: true }); for (let i = 0; i < 6; i++) say(() => sum(new Set1(i))); out.push(calls);
function Throws(x) { this.x = x; if (x > 2) throw new RangeError("r"); this.y = x; } for (let i = 0; i < 6; i++) say(() => sum(new Throws(i)));
function Arrow(x) { const f = () => this.x; this.x = x; this.y = f(); this.f = f; } for (let i = 0; i < 6; i++) say(() => sum(new Arrow(i)) + new Arrow(i).f());
function Base(x) { this.x = x; } function Heir(x) { Base.call(this, x); this.y = x + 1; } Heir.prototype = Object.create(Base.prototype); Heir.prototype.constructor = Heir; for (let i = 0; i < 6; i++) say(() => sum(new Heir(i)) + (new Heir(1) instanceof Base));
say(() => { P(7, 8); return globalThis.x + "" + globalThis.y; }); say(() => P.call(5, 1, 2)); say(() => { const o = {}; P.call(o, 1, 2); return sum(o); }); say(() => { P.apply(null, [3, 4]); return globalThis.x; }); delete globalThis.x; delete globalThis.y;
function Deleted(x) { this.x = x; this.y = x; } for (let i = 0; i < 6; i++) say(() => { const d = new Deleted(i); if (i & 1) delete d.x; return sum(d); });
function Twice(x) { this.x = x; this.x = x + 0.5; this.y = this; this.y = 1; } for (let i = 0; i < 6; i++) say(() => sum(new Twice(i))); say(() => sum(Reflect.construct(P, [1, 2], Base))); say(() => Object.keys(new P(1, 2)).join() + JSON.stringify(new Early(1)));
console.log(out.join("|"));
