// `o.m()` on an object whose class, prototype link and own properties code may change: what the class wrote under the name is called directly only while it still lies there, nothing hides it and the object stands below its class.
// Each change has classes of its own for each shape of site, because a guard that has ended stays ended: between two calls, in the middle of a loop, and in front of the first call.
// Under: --aot-testing=ForceStraightCompilation: the closed ways give the same answers
globalThis.report = value => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
let log = "", calls = 0;
const nameOfOwn = ["o", "w", "n"].join(""), nameOfM = String.fromCharCode(109);
function attempt(run) { log = ""; calls = 0; try { return run() + " [" + log + calls + "]"; } catch (e) { return (e instanceof TypeError ? "TypeError" : "other") + " [" + log + calls + "]"; } }
const hooks = [(o, own, above) => { own.own = function(x) { return "assigned own" + x; }; }, (o, own, above) => { above.m = function(x) { return "assigned m" + x; }; }, (o, own, above) => { own.m = function(x) { return "added m" + x; }; }, (o, own, above) => { Object.defineProperty(own, "own", { get() { log += "g"; return (x) => "getter own" + x; }, configurable: true }); }, (o, own, above) => { delete own.own; }, (o, own, above) => { o.own = (x) => "instance own" + x; }, (o, own, above) => { Object.defineProperty(o, "m", { get() { log += "i"; return (x) => "instance getter m" + x; }, configurable: true }); }, (o, own, above) => { o[nameOfOwn] = (x) => "computed own" + x; o[nameOfM] = (x) => "computed m" + x; }, (o, own, above) => { Object.setPrototypeOf(o, { own(x) { return "other own" + x; }, m(x) { return "other m" + x; } }); }, (o, own, above) => { Object.setPrototypeOf(o, Object.create(own, { m: { value: (x) => "hidden m" + x } })); }, (o, own, above) => { Object.setPrototypeOf(own, { m(x) { return "other parent m" + x; } }); }];
class A0t { m(x) { calls++; return "A0t.m" + x; } }
class C0t extends A0t { v = 0; own(x) { calls++; return "C0t.own" + x + this.v; } }
function run0t(o, hook) { let s = ""; for (let r = 0;r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C0t.prototype, A0t.prototype); s += "|" + o.own(r + 2) + o.m(r + 2) + ";"; } return s; }
class A0f { m(x) { calls++; return "A0f.m" + x; } }
class C0f extends A0f { v = 0; own(x) { calls++; return "C0f.own" + x + this.v; } }
function call0f(o) { let s = ""; for (let i = 0;i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run0f(o, hook) { hook(o, C0f.prototype, A0f.prototype); return call0f(o); }
class A1t { m(x) { calls++; return "A1t.m" + x; } }
class C1t extends A1t { v = 1; own(x) { calls++; return "C1t.own" + x + this.v; } }
function run1t(o, hook) { let s = ""; for (let r = 0;r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C1t.prototype, A1t.prototype); s += "|" + o.own(r + 2) + o.m(r + 2) + ";"; } return s; }
class A1f { m(x) { calls++; return "A1f.m" + x; } }
class C1f extends A1f { v = 1; own(x) { calls++; return "C1f.own" + x + this.v; } }
function call1f(o) { let s = ""; for (let i = 0;i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run1f(o, hook) { hook(o, C1f.prototype, A1f.prototype); return call1f(o); }
class A2t { m(x) { calls++; return "A2t.m" + x; } }
class C2t extends A2t { v = 2; own(x) { calls++; return "C2t.own" + x + this.v; } }
function run2t(o, hook) { let s = ""; for (let r = 0;r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C2t.prototype, A2t.prototype); s += "|" + o.own(r + 2) + o.m(r + 2) + ";"; } return s; }
class A2f { m(x) { calls++; return "A2f.m" + x; } }
class C2f extends A2f { v = 2; own(x) { calls++; return "C2f.own" + x + this.v; } }
function call2f(o) { let s = ""; for (let i = 0;i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run2f(o, hook) { hook(o, C2f.prototype, A2f.prototype); return call2f(o); }
class A3t { m(x) { calls++; return "A3t.m" + x; } }
class C3t extends A3t { v = 3; own(x) { calls++; return "C3t.own" + x + this.v; } }
function run3t(o, hook) { let s = ""; for (let r = 0;r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C3t.prototype, A3t.prototype); s += "|" + o.own(r + 2) + o.m(r + 2) + ";"; } return s; }
class A3f { m(x) { calls++; return "A3f.m" + x; } }
class C3f extends A3f { v = 3; own(x) { calls++; return "C3f.own" + x + this.v; } }
function call3f(o) { let s = ""; for (let i = 0;i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run3f(o, hook) { hook(o, C3f.prototype, A3f.prototype); return call3f(o); }
class A4t { m(x) { calls++; return "A4t.m" + x; } }
class C4t extends A4t { v = 4; own(x) { calls++; return "C4t.own" + x + this.v; } }
function run4t(o, hook) { let s = ""; for (let r = 0;r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C4t.prototype, A4t.prototype); s += "|" + o.own(r + 2) + o.m(r + 2) + ";"; } return s; }
class A4f { m(x) { calls++; return "A4f.m" + x; } }
class C4f extends A4f { v = 4; own(x) { calls++; return "C4f.own" + x + this.v; } }
function call4f(o) { let s = ""; for (let i = 0;i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run4f(o, hook) { hook(o, C4f.prototype, A4f.prototype); return call4f(o); }
class A5t { m(x) { calls++; return "A5t.m" + x; } }
class C5t extends A5t { v = 5; own(x) { calls++; return "C5t.own" + x + this.v; } }
function run5t(o, hook) { let s = ""; for (let r = 0;r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C5t.prototype, A5t.prototype); s += "|" + o.own(r + 2) + o.m(r + 2) + ";"; } return s; }
class A5f { m(x) { calls++; return "A5f.m" + x; } }
class C5f extends A5f { v = 5; own(x) { calls++; return "C5f.own" + x + this.v; } }
function call5f(o) { let s = ""; for (let i = 0;i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run5f(o, hook) { hook(o, C5f.prototype, A5f.prototype); return call5f(o); }
class A6t { m(x) { calls++; return "A6t.m" + x; } }
class C6t extends A6t { v = 6; own(x) { calls++; return "C6t.own" + x + this.v; } }
function run6t(o, hook) { let s = ""; for (let r = 0;r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C6t.prototype, A6t.prototype); s += "|" + o.own(r + 2) + o.m(r + 2) + ";"; } return s; }
class A6f { m(x) { calls++; return "A6f.m" + x; } }
class C6f extends A6f { v = 6; own(x) { calls++; return "C6f.own" + x + this.v; } }
function call6f(o) { let s = ""; for (let i = 0;i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run6f(o, hook) { hook(o, C6f.prototype, A6f.prototype); return call6f(o); }
class A7t { m(x) { calls++; return "A7t.m" + x; } }
class C7t extends A7t { v = 7; own(x) { calls++; return "C7t.own" + x + this.v; } }
function run7t(o, hook) { let s = ""; for (let r = 0;r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C7t.prototype, A7t.prototype); s += "|" + o.own(r + 2) + o.m(r + 2) + ";"; } return s; }
class A7f { m(x) { calls++; return "A7f.m" + x; } }
class C7f extends A7f { v = 7; own(x) { calls++; return "C7f.own" + x + this.v; } }
function call7f(o) { let s = ""; for (let i = 0;i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run7f(o, hook) { hook(o, C7f.prototype, A7f.prototype); return call7f(o); }
class A8t { m(x) { calls++; return "A8t.m" + x; } }
class C8t extends A8t { v = 8; own(x) { calls++; return "C8t.own" + x + this.v; } }
function run8t(o, hook) { let s = ""; for (let r = 0;r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C8t.prototype, A8t.prototype); s += "|" + o.own(r + 2) + o.m(r + 2) + ";"; } return s; }
class A8f { m(x) { calls++; return "A8f.m" + x; } }
class C8f extends A8f { v = 8; own(x) { calls++; return "C8f.own" + x + this.v; } }
function call8f(o) { let s = ""; for (let i = 0;i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run8f(o, hook) { hook(o, C8f.prototype, A8f.prototype); return call8f(o); }
class A9t { m(x) { calls++; return "A9t.m" + x; } }
class C9t extends A9t { v = 9; own(x) { calls++; return "C9t.own" + x + this.v; } }
function run9t(o, hook) { let s = ""; for (let r = 0;r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C9t.prototype, A9t.prototype); s += "|" + o.own(r + 2) + o.m(r + 2) + ";"; } return s; }
class A9f { m(x) { calls++; return "A9f.m" + x; } }
class C9f extends A9f { v = 9; own(x) { calls++; return "C9f.own" + x + this.v; } }
function call9f(o) { let s = ""; for (let i = 0;i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run9f(o, hook) { hook(o, C9f.prototype, A9f.prototype); return call9f(o); }
class A10t { m(x) { calls++; return "A10t.m" + x; } }
class C10t extends A10t { v = 10; own(x) { calls++; return "C10t.own" + x + this.v; } }
function run10t(o, hook) { let s = ""; for (let r = 0;r < 2; r++) { s += o.own(r) + o.m(r); if (r === 0) hook(o, C10t.prototype, A10t.prototype); s += "|" + o.own(r + 2) + o.m(r + 2) + ";"; } return s; }
class A10f { m(x) { calls++; return "A10f.m" + x; } }
class C10f extends A10f { v = 10; own(x) { calls++; return "C10f.own" + x + this.v; } }
function call10f(o) { let s = ""; for (let i = 0;i < 2; i++) s += o.own(i) + o.m(i); return s; }
function run10f(o, hook) { hook(o, C10f.prototype, A10f.prototype); return call10f(o); }
report(attempt(() => run0t(new C0t, hooks[0])));
report(attempt(() => run0f(new C0f, hooks[0])));
report(attempt(() => run1t(new C1t, hooks[1])));
report(attempt(() => run1f(new C1f, hooks[1])));
report(attempt(() => run2t(new C2t, hooks[2])));
report(attempt(() => run2f(new C2f, hooks[2])));
report(attempt(() => run3t(new C3t, hooks[3])));
report(attempt(() => run3f(new C3f, hooks[3])));
report(attempt(() => run4t(new C4t, hooks[4])));
report(attempt(() => run4f(new C4f, hooks[4])));
report(attempt(() => run5t(new C5t, hooks[5])));
report(attempt(() => run5f(new C5f, hooks[5])));
report(attempt(() => run6t(new C6t, hooks[6])));
report(attempt(() => run6f(new C6f, hooks[6])));
report(attempt(() => run7t(new C7t, hooks[7])));
report(attempt(() => run7f(new C7f, hooks[7])));
report(attempt(() => run8t(new C8t, hooks[8])));
report(attempt(() => run8f(new C8f, hooks[8])));
report(attempt(() => run9t(new C9t, hooks[9])));
report(attempt(() => run9f(new C9f, hooks[9])));
report(attempt(() => run10t(new C10t, hooks[10])));
report(attempt(() => run10f(new C10f, hooks[10])));
report("end");
