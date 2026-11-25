// Every way a sloppy function that stores on its `this` is entered. No "use strict" in this file.
var out = [], say = function (f) { try { out.push(String(f())); } catch (e) { out.push(e.name); } }, turns = function (k, f) { for (var i = 0; i < k; i++) say(function () { return f(i); }); };
function F(a, b) { this.a = a; this.b = b; } function both(o) { var s = ""; for (var i = 0; i < 3; i++) s += o.a + "," + o.b + ";"; return s; }
turns(30, function (i) { return both(new F(i, i + 0.5)); });
turns(3, function (i) { return both(F.call(5, i, 1) || "n") + both(F.call("t", i, 1) || "m"); });
turns(3, function (i) { F(i, 2); var r = globalThis.a + "" + globalThis.b; delete globalThis.a; delete globalThis.b; return r; });
turns(3, function (i) { F.apply(null, [i, 3]); F.apply(undefined, [i, 4]); Reflect.apply(F, void 0, [i, 5]); return globalThis.b; }); delete globalThis.a; delete globalThis.b;
turns(3, function (i) { var o = {}; Reflect.apply(F, o, [i, 6]); return both(o); });
function G(c) { this.c = c; } turns(3, function (i) { var r = Reflect.construct(F, [i, 7], G); return both(r) + r.c + (r instanceof G); });
class D extends F { constructor(a) { super(a, 8); this.d = a; } } turns(4, function (i) { return both(new D(i)) + new D(i).d; });
class D2 extends F { e = this.a; } turns(4, function (i) { return both(new D2(i, 9)) + new D2(i, 9).e; });
var Bound = F.bind({ z: 1 }, 11); turns(4, function (i) { return both(new Bound(i)) + (new Bound(i) instanceof F); });
function H(a) { F.call(this, a, 12); this.c = this.a + this.b; } turns(4, function (i) { return both(new H(i)) + new H(i).c; });
function Reads(v) { this.seen = typeof this.late + this.late; if (v & 1) this.late = v; else this.late = "t" + v; this.after = this.late; } turns(12, function (i) { var r = new Reads(i); return r.seen + r.late + r.after; });
function Part(v) { this.p = v; if (v > 2) return; this.q = v; } turns(6, function (i) { var r = new Part(i); return r.p + "" + r.q + ("q" in r); });
function Tries(v) { try { this.t = v; if (v & 1) throw 1; this.u = v; } catch (e) { this.w = v; } } turns(6, function (i) { var r = new Tries(i); return r.t + "" + r.u + r.w; });
function Loops(v) { for (var i = 0; i < v; i++) this["k"] = i; this.l = v; } turns(5, function (i) { var r = new Loops(i); return r.k + "" + r.l; });
function Evals(v) { eval("this.x1 = v"); this.y1 = v; } turns(3, function (i) { return new Evals(i).x1 + new Evals(i).y1; });
function Args() { arguments[0] = 9; this.m = arguments[0]; this.n = arguments.length; } turns(3, function (i) { var r = new Args(i, 1); return r.m + "" + r.n; });
function Getter(v) { this.v = v; } Object.defineProperty(Getter.prototype, "w", { get: function () { return typeof this.v; }, configurable: true }); function Uses(v) { this.first = this.w; this.v = v; } Uses.prototype = Getter.prototype; turns(5, function (i) { var r = new Uses(i); return r.first + r.w; });
function Closes(v) { var self = this; this.get = function () { return self.v; }; out.push(String(this.get())); this.v = v; } turns(4, function (i) { return new Closes(i).get(); });
function Frozen(v) { this.f = v; Object.freeze(this); this.g = v; } turns(3, function (i) { var r = new Frozen(i); return r.f + "" + r.g; });
function Gone(v) { this.h = v; delete this.h; this.h2 = v; } turns(4, function (i) { var r = new Gone(i); return r.h + "" + r.h2; });
function Self(v) { this.me = this; this.v = v; } turns(4, function (i) { return new Self(i).me.me.v; });
function* Gen() { this.z9 = 1; yield 2; } say(function () { return new Gen(); }); say(function () { var o = { Gen: Gen }; var g = o.Gen(); g.next(); return o.z9; });
var o2 = { set s(v) { out.push("set" + v); } }; function Sets(v) { this.s = v; this.r = v; } Sets.prototype = o2; turns(4, function (i) { var r = new Sets(i); return r.s + "" + r.r; });
function Twin(v) { if (!(this instanceof Twin)) return new Twin(v); this.tw = v; } turns(6, function (i) { return Twin(i).tw + new Twin(i).tw; });
function Last(v) { this.a = v; this.b = new Last2(this); } function Last2(p) { this.up = p.b; this.pa = p.a; } turns(4, function (i) { var r = new Last(i); return r.b.up + "" + r.b.pa; });
console.log(out.join("|"));
