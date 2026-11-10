'use strict';
class P { constructor(v) { this.v = v; } get() { return this.v * 2; } }
const K = JSON.parse('["a","m","late","constructor","l1","toString","g","1"]'), p = new P(1), out = [p.get()];
const say = f => { try { out.push(String(f())); } catch (e) { out.push(e.name); } out.push(typeof p.v); }, hit = x => { x.v = 't'; return 1; };
const o = { a: x => 1 }, run = (t, k) => t[k](p); say(() => run(o, K[0])); const all = [o, { b: 1 }, { c: 1 }, { d: 1 }, { e: 1 }, { f: 1 }]; const lay = t => { t.late = hit; }; for (const t of all) lay(t); say(() => run(o, K[0])); say(() => run(o, K[2]));
console.log(out.join(), p.get());
