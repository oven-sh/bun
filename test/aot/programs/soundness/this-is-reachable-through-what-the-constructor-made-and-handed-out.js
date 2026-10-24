// The object is reachable through something made in the constructor and handed out.
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
function mayThrow() { if (JSON.parse("true")) throw new RangeError("midway"); }
const seen = [];
let hold; function give(h) { hold = h; } function look(f) { return attempt(f); }
class A { constructor() { const box = { me: this }; give(box); seen.push(look(() => hold.me.fa.qe)); this.fa = { qe: 1 }; } }
new A();
class B { constructor() { give(() => this.fb.qe); seen.push(look(hold)); this.fb = { qe: 2 }; } }
new B();
class C { constructor() { give([[this]]); seen.push(look(() => hold[0][0].fc.qe)); this.fc = { qe: 3 }; } }
new C();
class D { constructor() { this.self = this; give(this.self); seen.push(look(() => hold.fd.qe)); this.fd = { qe: 4 }; } }
new D();
class E { constructor() { const m = new Map([[1, this]]); give(m); seen.push(look(() => hold.get(1).fe.qe)); this.fe = { qe: 5 }; } }
new E();
class F { constructor() { give(function* (o) { yield o.ff.qe; }(this)); seen.push(look(() => hold.next().value)); this.ff = { qe: 6 }; } }
new F();
class G { constructor() { give((async o => o.fg.qe)(this).then(v => v, e => "rejected " + e.constructor.name)); this.fg = { qe: 7 }; } }
new G(); seen.push(await hold);
class I { constructor() { give(this.m.bind(this)); seen.push(look(hold)); this.fi = { qe: 8 }; } m() { return this.fi.qe; } }
new I();
class J { constructor() { `${{ toString: () => (seen.push(look(() => this.fj.qe)), "") }}`; this.fj = { qe: 9 }; } }
new J();
class L { constructor() { give(new WeakRef(this)); seen.push(look(() => hold.deref().fl.qe)); this.fl = { qe: 10 }; } }
new L();
class N { constructor() { give(Object.assign({}, { me: this })); seen.push(look(() => hold.me.fn.qe)); this.fn = { qe: 11 }; } }
new N();
class O { constructor() { give({ ...{ me: this } }); seen.push(look(() => hold.me.fo.qe)); this.fo = { qe: 12 }; } }
new O();
class R { constructor() { give(Promise.resolve(this)); this.fr = { qe: 13 }; } }
new R(); seen.push((await hold).fr.qe);
console.log(seen.join("|"));
