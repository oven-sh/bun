'use strict';
class P { constructor(v) { this.v = v; } get() { return this.v * 2; } }
const K = JSON.parse('["a","m","late","constructor","l1","toString","g","1"]'), p = new P(1), out = [p.get()];
const say = f => { try { out.push(String(f())); } catch (e) { out.push(e.name); } out.push(typeof p.v); }, hit = x => { x.v = 't'; return 1; };
function t(x) { return 0; } t.a = x => 1; const run = (o, k) => o[k](p); say(() => run(t, K[0])); t.late = hit; say(() => run(t, K[2])); p.v = 1; const u = () => 0; Object.assign(u, { m: x => { x.v = 2.5; return 2; } }); say(() => run(u, K[1]));
console.log(out.join(), p.get());
