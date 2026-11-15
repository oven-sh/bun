// Stores that a sloppy constructor loses in silence. No "use strict" in this file.
var out = [], say = function (f) { try { out.push(String(f())); } catch (e) { out.push(e.name); } }, turns = function (f) { for (var i = 0; i < 12; i++) say(function () { return f(i); }); };
function look(o) { var s = ""; for (var i = 0; i < 4; i++) s += o.f + "," + o.g + ";" + ("g" in o) + Object.prototype.hasOwnProperty.call(o, "g"); return s; } function num(o) { var s = 0; for (var i = 0; i < 9; i++) s += o.f * 2 + o.g; return s; }
function A(v) { this.f = v; Object.freeze(this); this.g = v; } turns(function (i) { return look(new A(i)) + num(new A(i + 0.5)); });
function B(v) { this.f = v; Object.seal(this); this.g = v; } turns(function (i) { return look(new B(i)); });
function C(v) { this.f = v; Object.preventExtensions(this); this.g = v; this.f = v + 1; } turns(function (i) { return look(new C(i)); });
function D(v) { this.f = v; if (v & 1) Object.freeze(this); this.g = v; } turns(function (i) { return look(new D(i)) + num(new D(i)); });
function lock(o) { Object.freeze(o); } function E(v) { this.f = v; lock(this); this.g = v; } turns(function (i) { return look(new E(i)); });
function Base(v) { this.f = v; Object.freeze(this); } function F(v) { Base.call(this, v); this.g = v; } F.prototype = Object.create(Base.prototype); turns(function (i) { return look(new F(i)); });
function G(v) { this.f = v; this.g = v; } Object.defineProperty(G.prototype, "g", { value: "up" }); turns(function (i) { return look(new G(i)); });
function H(v) { this.f = v; this.g = v; } Object.defineProperty(H.prototype, "g", { get: function () { return "got"; } }); turns(function (i) { return look(new H(i)); });
function I(v) { this.f = v; this.g = v; } I.prototype.g = "low"; Object.freeze(I.prototype); turns(function (i) { return look(new I(i)); });
function J(v) { this.f = v; this.g = v; } J.prototype = { g: "lit" }; turns(function (i) { return look(new J(i)); }); Object.freeze(J.prototype); turns(function (i) { return look(new J(i)); });
function K(v) { this.f = v; this.g = v; } K.prototype = Object.freeze({ g: "fro" }); turns(function (i) { return look(new K(i)); });
function L(v) { this.f = v; this.g = v; } L.prototype = Object.create(Base.prototype, { g: { value: "map" } }); turns(function (i) { return look(new L(i)); });
function M(v) { this.f = v; this.g = v; } turns(function (i) { if (i === 5) Object.defineProperty(M.prototype, "g", { value: "late", configurable: true }); if (i === 9) delete M.prototype.g; return look(new M(i)) + num(new M(1)); });
class Up { get g() { return "cls"; } } function N(v) { this.f = v; this.g = v; } Object.setPrototypeOf(N.prototype, Up.prototype); turns(function (i) { return look(new N(i)); });
class O extends A { constructor(v) { super(v); try { this.h = v; } catch (e) { out.push(e.name); } } } turns(function (i) { return look(new O(i)) + new O(i).h; });
function Q(v) { Object.defineProperty(this, "f", { value: v }); this.f = 9; this.g = v; } turns(function (i) { return look(new Q(i)); });
function R(v) { this.f = v; this.g = v; Object.freeze(this); } turns(function (i) { var r = new R(i); r.g = 7; return look(r) + num(r); });
function S(v) { this.f = v; this.toString = v; this.constructor = v; this.g = v; } turns(function (i) { var r = new S(i); return look(r) + typeof r.toString + typeof r.constructor; });
console.log(out.join("|"));
