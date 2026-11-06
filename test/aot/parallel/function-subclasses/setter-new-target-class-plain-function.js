// `Reflect.construct(A, [], B)` runs A with an object below B.prototype. A setter there takes the store `this.v = ..`, so the object has no `v` of its own: it is not what `new A()` makes.
class A { constructor() { this.v = 1; } }
class B extends A { set v(x) {} }
const o = Reflect.construct(A, [], B);
console.log("a class as the target:", o.v, Object.keys(o).join() || "-");
function T() {} T.prototype = { set v(x) {} };
function C() { this.v = 1; }
const p = Reflect.construct(C, [], T);
console.log("new.target a plain function:", p.v, Object.keys(p).join() || "-");
