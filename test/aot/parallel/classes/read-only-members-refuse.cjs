// A read-only member of a prototype refuses stores, also into the objects below, and is found by every road.
"use strict";
function P(a) { this.a = a; } P.prototype.get = function () { return this.a; };
function Q(a) { this.a = a; this.q = 1; } Q.prototype.get = function () { return "q" + this.a; };
function A(a) { P.call(this, a); this.own = 1; }
A.prototype = Object.create(P.prototype, { constructor: { value: A }, make: { value: function (x) { return new A(x); } }, limit: { value: 5, enumerable: true }, parent: { value: P, configurable: true } });
function B(a) { Q.call(this, a); try { this.limit = a; } catch (e) { this.failed = e instanceof TypeError; } }
B.prototype = Object.create(Q.prototype, { constructor: { value: B }, limit: { value: "none" } });
Object.defineProperty(A.prototype, "twice", { value: function (x) { return [this.make(x), new this.parent(x)]; } });
function total(o) { var t = 0; for (var k in o) t += typeof o[k] === "number" ? o[k] : 0; return t; }
var sum = 0;
for (var i = 0; i < 60; i++) { var a = new A(i), b = new B(i); sum += total(a) + total(b) + a.make(i).get() + a.limit; }
console.log(sum, a.make(7).own, a.parent === P, b.limit, b.failed, a.twice(2)[0] instanceof A, a.twice(2)[1] instanceof A);
for (var [o, k, v] of [[a, "constructor", 1], [A.prototype, "constructor", B], [a, "make", null], [b, "limit", 2], [A.prototype, "limit", 9]]) try { o[k] = v; console.log("stored", k); } catch (e) { console.log(e instanceof TypeError, o[k] === v); }
console.log(Object.entries(Object.getOwnPropertyDescriptors(A.prototype)).map(([k, d]) => k + typeof d.value + d.writable + d.enumerable + d.configurable).join(" "));
var found = Object.getOwnPropertyDescriptor(A.prototype, "constructor").value, other = Reflect.get(A.prototype, ["con", "structor"].join(""));
console.log(new found(3).get(), new other(4).own, found === A, new (Object.getPrototypeOf(a).constructor)(5).get());
console.log(delete A.prototype.parent, a.parent, (() => { try { return delete A.prototype.make; } catch (e) { return e instanceof TypeError; } })());
Object.defineProperty(a, "limit", { value: 8, writable: true, configurable: true, enumerable: true });
a.limit++; console.log(a.limit, new A(1).limit, JSON.stringify(a));
Object.setPrototypeOf(A.prototype, Q.prototype); console.log(new A(2).get(), new A(2) instanceof Q, new A(2).constructor === A);
