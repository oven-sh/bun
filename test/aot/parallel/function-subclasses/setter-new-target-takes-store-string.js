// `Reflect.construct(A, [], B)` runs A with an object below B.prototype. A setter there takes the store `this.v = ..`, so the object has no `v` of its own: it is not what `new A()` makes.
function A() { this.v = "text"; this.w = 2; }
class B extends A { set v(x) {} }
const o = Reflect.construct(A, [], B);
console.log("read", o.v, o.w, Object.keys(o).join());
console.log("length", o.v === undefined ? "undefined" : o.v.length);
