'use strict';
class P { constructor(v) { this.v = v; } get() { return this.v * 2; } }
const K = JSON.parse('["a","m","late","constructor","l1","toString","g","1"]'), p = new P(1), out = [p.get()];
const say = f => { try { out.push(String(f())); } catch (e) { out.push(e.name); } out.push(typeof p.v); }, hit = x => { x.v = 't'; return 1; };
const src = { a: x => 1 }; src.late = hit; const copy = s => ({ ...s }), run = (o, k) => o[k](p); const c = copy(src), d = Object.assign({}, src); say(() => run(c, K[0])); say(() => run(c, K[2])); p.v = 1; say(() => run(d, K[2])); src.g = x => { x.v = 2.5; return 2; }; say(() => run(copy(src), K[6])); say(() => run(c, K[6]));
console.log(out.join(), p.get());
