'use strict';
class P { constructor(v) { this.v = v; } get() { return this.v * 2; } }
const K = JSON.parse('["a","m","late","constructor","l1","toString","g","1"]'), p = new P(1), out = [p.get()];
const say = f => { try { out.push(String(f())); } catch (e) { out.push(e.name); } out.push(typeof p.v); }, hit = x => { x.v = 't'; return 1; };
class B { a(x) { return 1; } run(k, x) { return this[k](x); } } class C extends B { m(x) { return 2; } } class D extends B { m(x) { return 3; } } class E extends B {} class F extends B {} class G extends B {} const os = [new C(), new D(), new E(), new F(), new G()]; for (const o of os) say(() => o.run(K[0], p)); os[3].late = hit; say(() => os[3].run(K[2], p)); p.v = 1; say(() => os[2].run(K[2], p));
console.log(out.join(), p.get());
