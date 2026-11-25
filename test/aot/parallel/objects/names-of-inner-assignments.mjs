// `o.a = o.b = v` creates b first. The order of the own keys, however they are created and read.
const out = [];
const held = new Map(); const get = k => held.get(k);
class Chain { constructor(v) { this.a = this.b = v; this.c = v; this.d = this.e = this.f = 0; } }
class Nested { constructor(v) { this.a = (this.b = v) + 1; this.c = Math.max(this.d = 3, v); this.e = [this.f = 1, this.g = v]; this.h = v > 2 ? this.i = 1 : (this.j = 2); } }
class Late { constructor(v) { this.a = () => { this.b = this.c = v; return this; }; this.d = this.e = v; if (v & 1) this.a(); } }
class Base { own = 1; constructor(v) { this.x = this.y = v; } }
class Heir extends Base { more = this.own; constructor(v) { super(v); this.a = this.y = this.b = v; } }
function Plain(v) { this.a = this.b = v; if (v > 2) this.c = this.d = v; this.e = this["f"] = v; }
Plain.prototype.b = 5;
function Comma(v) { return this.a = this.b = v, this.c = v, this.d = this.e = 1, this; }
const make = { Chain: v => new Chain(v), Nested: v => new Nested(v), Late: v => new Late(v), Heir: v => new Heir(v), Plain: v => new Plain(v), Comma: v => new Comma(v), literal: v => { var c = {}; c.a = c.b = v; c.c = v; c.d = c.e = c.f = 0; return c; }, filled: v => { const c = { z: 1 }; c.a = c.z = c.b = v; c.y = (c.x = v) + 1; return c; }, looped: v => { const c = {}; for (let i = 0; i < 2; i++) c.a = c.b = i; c.c = c.a; return c; }, caught: v => { const c = {}; try { c.a = c.b = v > 2 ? null.x : v; } catch { c.c = c.d = 1; } return c; } };
for (const k in make) held.set(k, make[k]);
for (const k of held.keys()) for (const v of [0, 1, 2, 3, 5]) { const o = get(k)(v); let names = ""; for (const n in o) names += n + " "; out.push(k + v + " " + Object.keys(o) + " | " + names + "| " + Object.entries({ ...o }).map(e => e[0]) + " | " + JSON.stringify(o)); const first = Object.keys(o)[0], was = o[first]; delete o[first]; o.later = 1; o[first] = was; out.push(String(Object.keys(o))); }
let total = 0; for (const k of held.keys()) for (let i = 0; i < 3000; i++) total = (total * 31 + Object.keys(get(k)(i & 7)).join().length) | 0;
out.push(total);
console.log(out.join("\n"));
