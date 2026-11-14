'use strict';
class P { constructor(v) { this.v = v; } get() { return this.v * 2; } }
const K = JSON.parse('["a","m","late","constructor","l1","toString","g","1"]'), p = new P(1), out = [p.get()];
const say = f => { try { out.push(String(f())); } catch (e) { out.push(e.name); } out.push(typeof p.v); }, hit = x => { x.v = 't'; return 1; };
const run = (t, k) => t[k](p); const all = [{ a: x => 1 }, { b: 1, a: x => 2 }, { c: 1, a: x => 3 }, { d: 1, a: x => 4 }, { e: 1, a: x => 5 }]; for (const t of all) say(() => run(t, K[0])); const late = { z: 1, a: x => 6 }; late.late = hit; say(() => run(late, K[0])); say(() => run(late, K[2]));
console.log(out.join(), p.get());
