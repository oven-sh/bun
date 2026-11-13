'use strict';
class P { constructor(v) { this.v = v; } get() { return this.v * 2; } }
const K = JSON.parse('["a","m","late","constructor","l1","toString","g","1"]'), p = new P(1), out = [p.get()];
const say = f => { try { out.push(String(f())); } catch (e) { out.push(e.name); } out.push(typeof p.v); }, hit = x => { x.v = 't'; return 1; };
function F(n) { this['q' + n] = n; } F.prototype.a = function (x) { return 1; }; function G(n) { this.w = n; } G.prototype = Object.create(F.prototype); G.prototype.m = function (x) { return 2; }; const run = (t, k) => t[k](p); say(() => run(new G(1), K[0])); F.prototype.late = hit; say(() => run(new G(2), K[2])); p.v = 1; G.prototype[K[6]] = x => { x.v = 2.5; return 3; }; say(() => run(new G(3), K[6]));
console.log(out.join(), p.get());
