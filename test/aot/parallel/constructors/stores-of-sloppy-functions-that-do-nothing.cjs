// Sloppy constructor functions whose stores do nothing: frozen, sealed, not extensible, read-only, setters and proxies above, by name, by unseen code, sometimes; numbers in raw slots. No "use strict".
var out = [], id = function (x) { return [x][JSON.parse("0")]; }, t = function (f) { try { var v = f(); out.push(typeof v + ":" + (Object.is(v, -0) ? "-0" : String(v))); } catch (e) { out.push(e.name); } };
function see(o) { var s = ""; for (var i = 0; i < 3; i++) s += o.f + "," + o.g + "," + (o.g === undefined ? "u" : typeof o.g) + ";"; return s + Object.keys(o).join() + ("g" in o) + Object.isExtensible(o); }
function sum(o) { var s = 0; for (var i = 0; i < 4; i++) s = s + o.f * 2 + o.g; return s; }
var lock = id(Object.freeze), seal = id(Object.seal), shut = id(Object.preventExtensions), define = id(Object.defineProperty);
function A(v) { this.f = v; Object.freeze(this); this.g = v; }
function B(v) { this.f = v + 0.5; Object.preventExtensions(this); this.g = v + 0.25; this.h = typeof this.g; }
function C(v) { this.f = v; if (v % 3 === 1) Object.seal(this); this.g = v + 0.5; this.f = v + 1; }
function D(v) { this.f = v; lock(this); this.g = v; this.k = this.g === undefined; }
function E(v) { this.f = v; Object.defineProperty(this, "g", { value: "fixed", writable: false, configurable: true, enumerable: true }); this.g = v; }
function F(v) { this.f = v; Object.defineProperty(this, "g", { get: function () { return "got"; }, configurable: true }); this.g = v; }
function G(v) { this.f = v; this.g = v; } Object.defineProperty(G.prototype, "g", { value: "above", writable: false, configurable: true });
function H(v) { this.f = v; this.g = v; } Object.defineProperty(H.prototype, "g", { set: function (x) { this.f = x + 1; }, get: function () { return "set"; }, configurable: true });
function I(v) { this.f = v; Object.setPrototypeOf(this, new Proxy({}, { set: function () { return true; }, get: function (o, k) { return k === "g" ? "proxy" : undefined; } })); this.g = v; }
function J(v) { this.f = v; Object.setPrototypeOf(this, id({ set g(x) {}, get g() { return "far"; } })); this.g = v; }
function K(v) { this.f = v; hide(this); this.g = v * 0.5; } function hide(o) { if (o.f > 9) shut(o); if (o.f > 14) seal(o); }
function L(v) { A.call(this, v); this.z = v; } function M(v) { this.f = v; Object.freeze(this); G2.call(this, v); } function G2(v) { this.f = v; this.g = v; }
var far = function () {}; far.prototype = Object.freeze({ g: "frozen above" }); var made = [A, B, C, D, E, F, G, H, I, J, K, L, M, G2];
for (var r = 0; r < 20; r++) { made.forEach(function (c) { t(function () { return see(new c(r)); }); t(function () { return sum(new c(r)); }); t(function () { return see(Reflect.construct(c, [r], far)); }); t(function () { var o = new G2(r); Object.freeze(o); c.call(o, r + 1); return see(o); }); t(function () { var o = Object.create(c.prototype); Object.preventExtensions(o); c.call(o, r); return see(o) + o.f; }); });
  t(function () { var l = []; for (var i = 0; i < 12; i++) l.push(new C(i), new K(i + 4)); return l.map(see).join() + l.map(sum).join(); }); t(function () { return new B(r).h + new D(r).k; }); }
console.log(out.join("|"));
