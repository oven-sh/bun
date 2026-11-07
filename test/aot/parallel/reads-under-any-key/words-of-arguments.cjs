'use strict';
class P { constructor(v) { this.v = v; } get() { return this.v * 2; } }
const K = JSON.parse('["a","m","late","constructor","l1","toString","g","1"]'), p = new P(1), out = [p.get()];
const say = f => { try { out.push(String(f())); } catch (e) { out.push(e.name); } out.push(typeof p.v); }, hit = x => { x.v = 't'; return 1; };
const T = { a: x => x + 1, m: x => 't' + x, g: x => x * 2 }, run = (k, x) => T[k](x); const o2 = { z: 1 }; o2.late = x => x.length; say(() => run(K[0], 2)); say(() => run(K[1], 'ext')); say(() => run(K[6], 1.5)); say(() => run(K[0], 'q')); say(() => run(K[6], 5n)); say(() => run(K[0], { valueOf: () => 7 })); say(() => o2[K[2]]('abc'));
console.log(out.join(), p.get());
