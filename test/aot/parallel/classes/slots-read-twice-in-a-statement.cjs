// Statements that read one slot twice (this.dial.a = this.dial.b) while the slot, the object in it and its fields are there, missing, accessors, frozen, replaced and of other classes.
"use strict";
const out = [];
class Dial { turn(p) { this.lit = false; this.near = null; this.tint = "t"; this.even = 0; this.cold = this.warm = p; return this; } both() { return { cold: this.cold, warm: this.warm }; } late(v) { this.added = v; } }
class Other { constructor() { this.even = 3; this.lit = 5; this.near = 4; this.cold = 2; this.tint = "o"; this.warm = 1; } }
class Oven {
  constructor(p) { this.dial = new Dial().turn(p); this.count = 0; }
  copy() { this.dial.near = this.dial.tint; this.dial.warm = this.dial.even; this.dial.even = this.dial.cold; }
  step(n) { this.dial.warm += n; this.dial.cold = this.dial.even; this.count += 1; this.dial.even = this.dial.warm; return this.dial.cold - this.dial.warm; }
  swap() { const old = this.dial.cold; this.dial.cold = this.dial.even; this.dial.even = old; }
  self() { this.dial.near = this.dial; return this.dial.near === this.dial; }
  chain() { this.dial.cold = this.dial.even = this.dial.warm; this.dial.lit = !this.dial.lit; }
  calls() { this.dial.near = this.dial.both(); this.dial.tint = this.dial.tint + this.dial.warm; }
  added() { this.dial.added = this.dial.added; this.dial.more = this.dial.warm; }
  reads() { return [this.dial.warm, this.dial.cold, this.dial.even, this.dial.tint, this.dial.near, this.dial.lit].map((v) => (v && typeof v === "object" ? Object.keys(v).join() : String(v))).join("|"); }
}
globalThis.kept = [Dial, Oven, Other];
const ways = ["copy", "step", "swap", "self", "chain", "calls", "added"];
const show = (name, f) => { let r; try { r = f(); } catch (e) { r = e.constructor.name + ": " + String(e.message).replace(/^[^]* is not (?:a function|an Object)[^]*| \((?:evaluating|near) '[^]*/, "").slice(0, 40); } out.push(name + " " + String(r)); };
function every(name, make) {
  for (const way of ways) {
    let s;
    show(name + " made " + way, () => { s = make(); return "ok"; });
    if (!s) continue;
    show(name + " " + way, () => Oven.prototype[way].call(s, 2));
    show(name + " again " + way, () => Oven.prototype[way].call(s, 1.5));
    show(name + " read " + way, () => Oven.prototype.reads.call(s));
    show(name + " keys " + way, () => Object.keys(s.dial || {}).join());
  }
}
every("plain", () => new Oven(3));
every("empty", () => { const s = new Oven(1); s.dial = new Dial(); return s; });
every("other", () => { const s = new Oven(1); s.dial = new Other(); return s; });
every("record", () => { const s = new Oven(1); s.dial = { warm: 1, cold: 2 }; return s; });
every("missing", () => { const s = new Oven(1); delete s.dial; return s; });
every("null", () => { const s = new Oven(1); s.dial = null; return s; });
every("number", () => { const s = new Oven(1); s.dial = 7; return s; });
every("text", () => { const s = new Oven(1); s.dial = "some"; return s; });
every("frozen", () => { const s = new Oven(4); Object.freeze(s.dial); return s; });
every("sealed", () => { const s = new Oven(4); Object.seal(s.dial); return s; });
every("read-only", () => { const s = new Oven(4); Object.defineProperty(s.dial, "cold", { value: 9, writable: false }); return s; });
every("getter", () => { const s = new Oven(4); let n = 0; const a = s.dial, b = new Dial().turn(50); Object.defineProperty(s, "dial", { get() { return n++ & 1 ? a : b; }, configurable: true }); return s; });
every("getter of two classes", () => { const s = new Oven(4); let n = 0; const a = s.dial, b = new Other(); Object.defineProperty(s, "dial", { get() { return n++ % 3 ? a : b; }, configurable: true }); return s; });
every("field replaces", () => { const s = new Oven(4); const a = s.dial; Object.defineProperty(a, "warm", { get() { s.dial = new Dial().turn(70); return 5; }, set(v) { this.got = v; }, configurable: true }); return s; });
every("field throws", () => { const s = new Oven(4); Object.defineProperty(s.dial, "cold", { get() { throw new Error("cold"); }, configurable: true }); return s; });
every("setter", () => { const s = new Oven(4); Object.defineProperty(s.dial, "even", { get() { return 8; }, set(v) { s.dial = null; }, configurable: true }); return s; });
every("proxy", () => { const s = new Oven(4); const log = []; s.dial = new Proxy(s.dial, { get(t, k) { log.push("g" + String(k)); return t[k]; }, set(t, k, v) { log.push("s" + String(k)); t[k] = v; return true; } }); s.log = log; return s; });
every("text in field", () => { const s = new Oven(4); s.dial.warm = "x"; s.dial.even = undefined; return s; });
every("deleted field", () => { const s = new Oven(4); delete s.dial.cold; delete s.dial.near; return s; });
every("bigint", () => { const s = new Oven(4); s.dial.warm = 3n; return s; });
every("foreign", () => ({ dial: { warm: 2, cold: 1, both() { return 5; } }, count: 1 }));
every("heir", () => { class Deep extends Oven { get own() { return 1; } } return new Deep(6); });
every("heir of dial", () => { class Finer extends Dial { get tint() { return "d"; } set tint(v) { this.seen = v; } } const s = new Oven(1); s.dial = new Finer().turn(2); return s; });
Object.defineProperty(Dial.prototype, "even", { get() { return "above"; }, set(v) { this.above = v; }, configurable: true });
every("accessor above", () => { const s = new Oven(4); s.dial = new Dial(); s.dial.warm = 1; s.dial.cold = 2; return s; });
delete Dial.prototype.even;
Dial.prototype.cold = 11; every("inherited", () => { const s = new Oven(4); s.dial = new Dial(); s.dial.warm = 1; return s; }); delete Dial.prototype.cold;
const many = new Oven(0); let sum = 0; for (let i = 0; i < 300; i++) { many.copy(); sum += many.step(i % 3); many.swap(); many.chain(); if (i === 200) many.dial = new Other(); if (i === 250) many.dial = new Dial().turn(1); }
show("many", () => [sum, many.reads(), many.count]);
for (const line of out) console.log(line);
