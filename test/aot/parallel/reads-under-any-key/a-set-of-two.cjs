'use strict';
class P { constructor(v) { this.v = v; } get() { return this.v * 2; } }
const K = JSON.parse('["a","m","late","constructor","l1","toString","g","1"]'), p = new P(1), out = [p.get()];
const say = f => { try { out.push(String(f())); } catch (e) { out.push(e.name); } out.push(typeof p.v); }, hit = x => { x.v = 't'; return 1; };
const t = { a: x => 1, z: 1 }, u = { m: x => 2, y: 1 }, run = (o, k) => o[k](p); say(() => run(t, K[0])); say(() => run(u, K[1])); t.late = hit; say(() => run(t, K[2])); p.v = 1; say(() => run(u, K[2]));
console.log(out.join(), p.get());
