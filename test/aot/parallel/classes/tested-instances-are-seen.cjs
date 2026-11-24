// Whoever gets the new object before its fields are filled sees it without them.
"use strict";
var seen = [];
function note(o) { seen.push(Object.keys(o).join() + "|" + o.x + "|" + o.y); }
function keeps(a, n) { if (!(a instanceof n)) throw new TypeError("no"); note(a); }
function reads(a, n) { if (!(a instanceof n) || a.x) throw new TypeError("x" + a.x); }
function answers(a, n) { return a instanceof n && a; }
function listed() { if (!(arguments[0] instanceof arguments[1])) throw new TypeError("no"); return arguments; }
function rest(...all) { if (!(all[0] instanceof all[1])) throw new TypeError("no"); seen.push(all.length + typeof all[0].x); }
function stored(a, n) { stored.last = a; if (!(a instanceof n)) throw new TypeError("no"); }
function swapped(n, a) { if (!(a instanceof n)) throw new TypeError("no"); }
function A(x) { keeps(this, A); this.x = x; this.y = 1; }
function B(x) { reads(this, B); this.x = x; this.y = 2; }
function C(x) { var self = answers(this, C); note(self); this.x = x; this.y = 3; }
function D(x) { note(listed(this, D)[0]); this.x = x; this.y = 4; }
function E(x) { rest(this, E); this.x = x; this.y = 5; }
function F(x) { stored(this, F); note(stored.last); this.x = x; this.y = 6; }
function G(x) { swapped(G, this); this.x = x; this.y = 7; }
function H(x) { if (!(this instanceof H)) return new H(x); this.x = x; this.y = 8; }
Object.defineProperty(H, Symbol.hasInstance, { value: function (o) { if (o) note(o); return Function.prototype[Symbol.hasInstance].call(this, o); } });
function I(x) { if (!(this instanceof I)) throw new TypeError("no"); this.x = x; this.y = 9; }
I.prototype = new Proxy({ own: 1 }, { getPrototypeOf: function (t) { seen.push("trap" + Object.keys(t).join()); return Object.prototype; }, get: function (t, k) { return k === "sum" ? function () { return this.x + this.y; } : t[k]; } });
function J(x) { if (!(this instanceof J)) throw new TypeError("no"); if (x > 2) return { x: "other", y: x }; this.x = x; this.y = 10; }
function K(x) { var other = x === 1 ? A : K; if (!(this instanceof other)) this.x = -1; else this.x = x; this.y = 11; }
function L(x) { this.x = 0; if (!(this instanceof L)) return 5; note(this); this.y = x; }
function total(o) { return (o.x || 0) + (o.y || 0); }
var all = [A, B, C, D, E, F, G, H, I, J, K, L], sum = 0;
for (var r = 0; r < 4; r++) for (var f of all) { var o = new f(r); sum += total(o); if (r === 3) console.log(f.name, Object.keys(o).join(), o.x, o.y, total(o)); }
console.log(sum, seen.length, seen.join(" "));
console.log(total(H(5)), new I(3).sum());
// A test of its own comes later, and one by way of the parent.
Object.defineProperty(G, Symbol.hasInstance, { value: function (o) { note(o); return true; }, configurable: true });
seen = []; console.log(total(new G(1)), seen.join());
Object.setPrototypeOf(J, { [Symbol.hasInstance]: function (o) { note(o); return true; } });
seen = []; console.log(total(new J(1)), seen.join());
delete G[Symbol.hasInstance]; seen = []; console.log(total(new G(1)), seen.join());
