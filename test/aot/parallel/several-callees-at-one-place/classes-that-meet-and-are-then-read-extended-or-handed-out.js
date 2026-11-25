// Classes meet at a place that is constructed, and then something else is done with what lies there: a static read, a store, instanceof, extends, a prototype changed, a fifth class, a class of the same family.
class A { k = 1; static label = "A"; who() { return "a" + this.k; } }
class B { k = 2; static label = "B"; who() { return "b" + this.k; } }
function make(i) { const C = i & 1 ? A : B; return new C(); }
console.log(make(1).who(), make(2).who(), make(1).k + make(2).k);

class P { k = 3; static label = "P"; }
class Q { k = 4; static label = "Q"; }
function label(i) { const C = i & 1 ? P : Q; return C.label + new C().k + C.name + C.length; }
console.log(label(1), label(2));

class R { k = 5; }
class S { k = 6; }
function mark(i) { const C = i & 1 ? R : S; C.seen = (C.seen || 0) + 1; return new C().k; }
console.log(mark(1), mark(2), mark(3), R.seen, S.seen);

class T { k = 7; }
class U { k = 8; }
function test(i, o) { const C = i & 1 ? T : U; return o instanceof C; }
console.log(test(1, new T()), test(2, new T()), test(1, new U()), test(2, new U()));

class V { k = 9; hello() { return "v"; } }
class W { k = 10; hello() { return "w"; } }
function below(i) { const C = i & 1 ? V : W; return class extends C { m = this.k + 1; }; }
console.log(new (below(1))().m, new (below(2))().m, new (below(1))().hello(), new (below(2))().hello());

class X { k = 11; }
class Y { k = 12; }
function patched(i) { const C = i & 1 ? X : Y; C.prototype.extra = "extra" + i; return new C(); }
console.log(patched(1).extra, patched(2).extra, new X().extra, new Y().extra);

class Base { k = 13; }
class Left extends Base { l = 1; }
class Right extends Base { r = 2; }
class Stranger { k = 14; }
function family(i) { const C = i % 3 === 0 ? Left : i % 3 === 1 ? Right : Stranger; const o = new C(); return o.k + (o.l || 0) + (o.r || 0); }
console.log(family(0), family(1), family(2));

class C1 { k = 21; } class C2 { k = 22; } class C3 { k = 23; } class C4 { k = 24; } class C5 { k = 25; }
const five = [C1, C2, C3, C4, C5];
let sum = 0;
for (let i = 0; i < 10; i++) { const C = i % 5 === 0 ? C1 : i % 5 === 1 ? C2 : i % 5 === 2 ? C3 : i % 5 === 3 ? C4 : C5; sum += new C().k; }
console.log(sum, five.map((C) => new C().k).join());

class G { k = 31; constructor() { return i31; } }
class H { k = 32; }
const i31 = { k: "older" };
function older(i) { const C = i & 1 ? G : H; return new C().k; }
console.log(older(1), older(2));

class Frozen { k = 41; }
class Open { k = 42; }
function freeze(i) { const C = i & 1 ? Frozen : Open; const o = new C(); if (i & 1) Object.freeze(o); try { "use strict"; o.k = 0; } catch (error) { return error.constructor.name; } return o.k; }
console.log(freeze(1), freeze(2));

Object.setPrototypeOf(B.prototype, { inherited: "late" });
console.log(make(2).inherited, make(1).inherited);
