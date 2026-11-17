const say = (...a) => console.log(...a.map(x => typeof x === "function" ? x.toString() : x));
function p1(a, f = eval("(() => a)")) { var a = 2; return f(); }
function p2(a, f = eval("(function () { return a; })"), g = () => a) { var a = 2; return [f(), g(), a]; }
const p3 = (a, f = eval("(function () { return a; })")) => f();
const p4 = (a, f = eval("(function (x) { a = x; })")) => (f(5), a);
function p5({ a }, [f = eval("(function () { return a; })")] = []) { a++; return f(); }
function p6(a, f = eval("(function () { return typeof b; })")) { var b = 1; return f(); }
say(p1(1), p2(1), p3(1), p4(1), p5({ a: 1 }), p6(1));
class C { constructor(x, f = eval("(function () { return x; })")) { this.f = f; } static #y = 3; static z = eval("(function () { return 4; })")(); set s(v = eval("(function () { return 1; })")()) { this.v = v; } }
const c = new C(7); say(c.f(), C.z); c.s = undefined; say(c.v);
const o = { m(x, g = eval("(() => x)")) { x = 9; return g(); }, get k() { return eval("(function () { return 6; })")(); }, [eval("(function () { return 'key'; })")()]: 1 };
say(o.m(1), o.k, o.key);
label: for (const x of [1, 2]) { const f = eval("(function () { return x; })"); if (x === 1) continue label; say(f()); }
try { throw eval("(function () { return 'thrown'; })"); } catch (e) { say(e()); }
switch (1) { case 1: let w = 3; say(eval("(function () { return w; })")()); }
say([1, 2, 3].map(eval("(function (x) { return x * 2; })")).join());
say((x => eval("(function () { return x; })"))(5)());
function* gen() { const a = yield 1; yield eval("(function () { return a; })"); }
const it = gen(); it.next(); say(it.next(8).value());
(async () => { const v = await 1; const f = eval("(function () { return v; })"); await 2; say(f()); })();
