// Variables of a function that closures capture, and static fields, read before their stores.
const out = [];
function show(name, v) { out.push(name + ": " + typeof v + " " + String(v)); }
function attempt(f) { try { return f(); } catch (e) { return e.constructor.name; } }
function run(f) { return f(); }

function e1() { const g = () => { const t = x; return t === undefined ? "missing" : t + 1; }; const r = g(); var x = 1; return r + "," + g(); } show("captured var", e1());
function e2() { const g = () => x + 1; const r = attempt(g); let x = 1; return r + "," + g(); } show("captured let", e2());
function e3() { const g = () => x + 1; const r = attempt(() => run(g)); const x = 1; return r + "," + g(); } show("captured const", e3());
function e4() { function g() { const t = x; return t === undefined ? "missing" : t + 1; } const r = [0].map(g)[0]; var x = 1; return r + "," + g(); } show("captured var, map", e4());
function e5() { const o = { get v() { const t = x; return t === undefined ? "missing" : t + 1; } }; const r = o.v; var x = 1; return r + "," + o.v; } show("captured var, getter", e5());
function e6() { const fs = []; for (let i = 0; i < 2; i++) { fs.push(() => y + 1); if (i == 1) fs.push(attempt(fs[1])); let y = i; } return fs[0]() + "," + fs[2] + "," + fs[1](); } show("per iteration", e6());
function e7() { let keep; for (let i = 0; i < 2; i++) { const g = () => y + 1; if (keep) return attempt(g) + "," + keep(); keep = g; let y = i; } } show("closure of an earlier iteration", e7());
function e8(c) { const g = () => { const t = x; return t === undefined ? "missing" : t + 1; }; if (c) { var x = 1; } return g(); } show("conditional captured store", e8(false) + "," + e8(true));
function e9() { const g = () => { const t = x; return t === undefined ? "missing" : t + 1; }; try { throw 0; var x = 1; } catch { } return g(); } show("captured store after throw", e9());
function e10() { const inner = () => () => () => { const t = x; return t === undefined ? "missing" : t + 1; }; const r = inner()()(); var x = 1; return r; } show("nested closures", e10());
function* e11() { const g = () => { const t = x; return t === undefined ? "missing" : t + 1; }; yield g; var x = 1; yield g; } { const it = e11(); const a = it.next().value(); const b = it.next().value(); show("generator", a + "," + b); }
function e12() { let x = 1; const set = () => { x = "two"; }; const get = () => x + 1; const a = get(); run(set); return a + "," + get(); } show("captured second store", e12());
function e13() { let x = 1; const t = { a() { }, undefined() { x = "two"; } }; const get = () => x + 1; const call = () => t[k](); call(); var k = "a"; return get(); } show("captured second store by late key", e13());
function e14(n) { let x = 1; const get = () => x + 1; if (n) { x = 1.5; } return get(); } show("captured conditional second store", e14(0) + "," + e14(1));
function e15() { const a = []; for (var i = 0; i < 2; i++) { a.push(() => i + 1); } return a[0]() + "," + a[1](); } show("shared loop variable", e15());
function e16(p = () => { const t = q; return t === undefined ? "missing" : t + 1; }) { var q = 1; return attempt(p); } show("parameter scope", e16());
function e17() { return attempt(() => { const r = g(); let z = 1; function g() { return z + 1; } return r; }); } show("hoisted inner function", e17());
function e18() { class A { static m() { return attempt(() => B.n); } } const r = A.m(); class B { static n = 1; } return r + "," + A.m(); } show("captured class", e18());

class S1 { static a = S1.b; static b = 1; } show("static order", (t => t === undefined ? "missing" : t + 1)(S1.a));
class S2 { static a = peek2(S2); static b = 1; } function peek2(c) { const t = c.b; return t === undefined ? "missing" : t + 1; } show("static helper", S2.a + "," + peek2(S2));
class S3 { static a = Object.values(S3).length; static b = 1; } show("static values", S3.a + "," + Object.values(S3).length);
class S4 { static a = Reflect.get(S4, "b"); static b = 1; } show("static Reflect.get", (t => t === undefined ? "missing" : t + 1)(S4.a));
class S5 { static a = (({ b }) => b === undefined ? "missing" : b + 1)(S5); static b = 1; } show("static destructuring", S5.a);
class S6 { static a = S6["b"]; static b = 1; } show("static computed", (t => t === undefined ? "missing" : t + 1)(S6.a));
class S7 { static a = "b" in S7; static b = 1; } show("static in", S7.a + "," + ("b" in S7));
class S8 { static a = Object.hasOwn(S8, "b"); static b = 1; } show("static hasOwn", S8.a);
class S9 { static a = JSON.stringify({ ...S9 }); static b = 1; } show("static spread", S9.a);
class S10 { static b = 1; } class S11 extends S10 { static a = S11.b; } show("static inherited", S11.a + 1);
class S12 { static a = this.get(); static get() { const t = this.b; return t === undefined ? "missing" : t + 1; } static b = 1; } show("static this", S12.a + "," + S12.get());
class S13 { static { this.a = (t => t === undefined ? "missing" : t + 1)(this.b); } static b = 1; } show("static block", S13.a);
class S14 { static b = 1; static a = (S14.b = "two"); } show("static second store", S14.b + 1);
class S15 { static b = 1; } Object.assign(S15, { b: "two" }); show("static assign", S15.b + 1);
class S16 { static b = 1; } Reflect.set(S16, "b", "two"); show("static Reflect.set", S16.b + 1);
class S17 { static b = 1; } Object.defineProperty(S17, "b", { value: "two" }); show("static define", S17.b + 1);
class S18 { static b = 1; } delete S18.b; show("static delete", (t => t === undefined ? "missing" : t + 1)(S18.b));
class S19 { static b = 1; } const k19 = "b"; S19[k19] = "two"; show("static computed store", S19.b + 1);
class S20 { static b = 1; } class S21 extends S20 { } S21.b = "two"; show("static store on subclass", S20.b + 1 + "," + (S21.b + 1));
function mk22() { return class { static n = 0; static inc() { return ++this.n; } }; } const A22 = mk22(), B22 = mk22(); A22.inc(); A22.inc(); show("class evaluated twice", A22.n + "," + B22.n);
function mk23(early) { return class K { static a = early(K); static b = 1; }; } const seen23 = []; mk23(c => seen23.push(c.b === undefined ? "missing" : c.b + 1)); mk23(c => seen23.push(c.b === undefined ? "missing" : c.b + 1)); show("class evaluated twice, read early", seen23.join());

console.log(out.join("\n"));
