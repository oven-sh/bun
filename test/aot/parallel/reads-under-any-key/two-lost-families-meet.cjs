'use strict';
class P { constructor(v) { this.v = v; } get() { return this.v * 2; } }
const K = JSON.parse('["a","m","late","constructor","l1","toString","g","1"]'), p = new P(1), out = [p.get()];
const say = f => { try { out.push(String(f())); } catch (e) { out.push(e.name); } out.push(typeof p.v); }, hit = x => { x.v = 't'; return 1; };
const run = (t, k) => t[k](p), lay = t => { t.late = hit; }, one = [{ a: x => 1, q1: 1 }, { a: x => 1, q2: 1 }, { a: x => 1, q3: 1 }, { a: x => 1, q4: 1 }, { a: x => 1, q5: 1 }], two = [{ m: x => 2, r1: 1 }, { m: x => 2, r2: 1 }, { m: x => 2, r3: 1 }, { m: x => 2, r4: 1 }, { m: x => 2, r5: 1 }]; for (const t of one) say(() => run(t, K[0])); for (const t of two) lay(t); for (const t of two) say(() => run(t, K[1])); const both = one.concat(two); say(() => both.map(t => typeof t[K[2]]).join('')); say(() => run(two[3], K[2]));
console.log(out.join(), p.get());
