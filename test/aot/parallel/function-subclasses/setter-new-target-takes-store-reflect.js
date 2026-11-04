// `Reflect.construct(A, [], B)` runs A with an object below B.prototype. A setter there takes the store `this.v = ..`, so the object has no `v` of its own: it is not what `new A()` makes.
function A() { this.v = 1; }
class B extends A { set v(x) {} }
const o = Reflect.construct.call(null, A, [], B);
console.log("Reflect.construct.call(null, A, [], B):", o.v, Object.keys(o).join() || "-", o instanceof B);
