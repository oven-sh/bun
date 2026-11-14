// A test of its own is found on the function, on a parent that it is linked below, and on what is linked later; the prototype may be replaced.
"use strict";
var seen = [];
function link(t, e) { Object.setPrototypeOf(t, e); t.prototype = Object.create(e.prototype); t.prototype.constructor = t; }
function P(x) { this.x = x; } function A(x) { P.call(this, x); this.a = 1; } link(A, P); function B(x) { A.call(this, x); this.b = 2; } link(B, A);
function Q(x) { this.q = x; } function C(x) { Q.call(this, x); this.c = 3; } link(C, Q);
Object.defineProperty(Q, Symbol.hasInstance, { value: function (o) { seen.push(this.name + (o && o.q) + (o && o.c)); return true; }, configurable: true });
function D(x) { P.call(this, x); } link(D, P);
D[Symbol.hasInstance] === Function.prototype[Symbol.hasInstance] && seen.push("ordinary");
function test(o, f) { try { return o instanceof f; } catch (e) { return e.constructor.name; } }
var all = [P, A, B, Q, C, D], sum = 0;
for (var r = 0; r < 20; r++) for (var f of all) { var o = new f(r); for (var g of all) sum += test(o, g) === true ? 1 : 0; if (r === 2) console.log(f.name, all.map(function (g) { return test(o, g); }).join(), Object.keys(o).join()); }
console.log(sum, seen.length, seen.slice(0, 6).join(" "));
B.prototype = A.prototype; console.log(test(new A(1), B), test(new P(1), B));
B.prototype = 5; console.log(test(new A(1), B)); B.prototype = { own: 1 }; console.log(test(new A(1), B), test(Object.create(B.prototype), B), new B(1).own);
Object.setPrototypeOf(A, Q); seen = []; console.log(test(new A(1), A), seen.join()); console.log(test({}, B), seen.join());
Object.setPrototypeOf(A, null); console.log(test(new P(2), A), test(new A(2), A));
var bound = D.bind(null); console.log(test(new D(1), bound), test(new P(1), bound), test(new D(1), new Proxy(D, {})), test({}, {}), test({}, function () {}.prototype));
