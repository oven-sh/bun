"use strict";
class Pair { constructor(n) { if (n & 1) { this.a = n; this.b = 1; } else { this.a = null; this.b = n; } } }
function Given(given) { var held = given || {}; this.a = held.a; this.b = held.b; }
function records(n) { let s = 0; for (let i = 0; i < n; i++) { const o = { x: i, y: 2 }; if (i & 1) o.x = 5; else o.y = -0; s += o.x * 10 + (Object.is(o.y, -0) ? 1 : o.y); } return s; }
function instances(n) { let s = ""; for (let i = 0; i < n; i++) { const p = new Pair(i); s += p.a + "," + p.b + ";"; } return s; }
function optional(n) { const all = [{ a: 1, b: "t" }, undefined, { a: 2 }, null]; let s = ""; for (let i = 0; i < n; i++) { const p = new Given(all[i & 3]); s += p.a + typeof p.b + ("b" in p); } return s; }
function nested(n) { let s = 0; for (let i = 0; i < n; i++) { const p = { v: i }, o = { x: 0, p }; if (i & 1) { o.x = p.v; p.v = 9; } else { p.v = o.x + 1; } s += o.x + o.p.v + p.v; } return s; }
function escapes(n) { const kept = []; for (let i = 0; i < n; i++) { const o = { x: i, y: 1 }; if (i & 1) { kept.push(o); o.x = "kept"; } else o.x = undefined; if (i > 3) o.y = o.x; } return JSON.stringify(kept); }
for (const f of [records, instances, optional, nested, escapes]) console.log(f.name, f(0), f(1), f(8));
