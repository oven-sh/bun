// Whoever gets an heir's object before its fields are filled sees it without them.
"use strict";
var seen = [];
function note(o) { seen.push(Object.keys(o).join() + "|" + o.x + "|" + o.y + "|" + o.own); }
function link(t, e) { t.prototype = Object.create(e.prototype); t.prototype.constructor = t; }
function keeps(a, n) { if (!(a instanceof n)) throw new TypeError("no"); note(a); }
function only(a, n) { if (!(a instanceof n)) throw new TypeError("no"); }
function Base(x) { only(this, Base); this.x = x; this.y = 1; }
Base.prototype.sum = function () { return this.x + this.y; };
function Shown(x) { keeps(this, Shown); this.x = x; this.y = 2; }
Shown.prototype.sum = function () { return this.x + this.y; };
function A(x) { only(this, A); Base.call(this, x); this.own = 1; } link(A, Base);
function B(x) { keeps(this, B); Base.call(this, x); this.own = 2; } link(B, Base);
function C(x) { only(this, C); Shown.call(this, x); this.own = 3; } link(C, Shown);
function D(x) { if (!(this instanceof D)) return new D(x); Base.apply(this, arguments); this.own = 4; } link(D, Base);
function E(x) { if (!(this instanceof E)) throw new TypeError("no"); note(this); Base.call(this, x); this.own = 5; } link(E, Base);
function F(x) { only(this, F); if (x === 2) return { x: "x", y: "y", own: "other" }; Base.call(this, x); this.own = 6; } link(F, Base);
function G(x) { only(this, G); Base.call(this, x); note(this); this.own = 7; } link(G, Base);
function H(x) { this.own = 8; only(this, H); Base.call(this, x); } link(H, Base);
function I(x) { only(this, I); B.call(this, x); this.last = 1; } link(I, B);
Object.defineProperty(H, Symbol.hasInstance, { value: function (o) { note(o); return true; } });
class K extends A { constructor(x) { super(x); this.k = 1; } }
class L extends Shown { l = 2; }
var all = [Base, Shown, A, B, C, D, E, F, G, H, I, K, L], sum = 0;
for (var r = 0; r < 40; r++) for (var f of all) { var o = new f(r % 4); sum += typeof o.own === "number" ? o.own : 0; if (r === 3) console.log(f.name, Object.keys(o).join(), o.x, o.y, o.own, o.sum && o.sum()); }
console.log(sum, seen.length, seen.slice(0, 24).join(" "));
Object.defineProperty(Base, Symbol.hasInstance, { value: function (o) { note(o); return true; } });
seen = [];
for (var f of [Base, A, D, K]) { var o = new f(5); console.log(f.name, Object.keys(o).join(), o.x + o.y, seen.length); }
console.log(seen.join(" "));
