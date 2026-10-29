// `Reflect.construct(A, [], B)` runs A with an object below B.prototype. A setter there takes the store `this.v = ..`, so the object has no `v` of its own: it is not what `new A()` makes.
function show(name, o) { console.log(name + ":", o.v, Object.keys(o).join() || "-", Object.getPrototypeOf(o).constructor.name); }
function A() { this.v = 1; }
class B extends A { set v(x) {} }
show("new B()", new B());
show("Reflect.construct(A, [], B)", Reflect.construct(A, [], B));
show("new A()", new A());
function A2() { this.v = 1; }
class B2 extends A2 { set v(x) { this.seen = x; } get v() { return "got"; } }
show("a getter and a setter, new", new B2());
show("a getter and a setter, Reflect.construct", Reflect.construct(A2, [], B2));
class A3 { constructor() { this.v = 1; } }
class B3 extends A3 { set v(x) {} }
show("a class below a class, new", new B3());
show("a class below a class, Reflect.construct", Reflect.construct(A3, [], B3));
function A4() { this.v = 1; }
function T4() {} T4.prototype = { set v(x) {}, constructor: T4 };
show("new.target a plain function", Reflect.construct(A4, [], T4));
function A5() { this.v = 1; }
function T5() {} Object.defineProperty(T5.prototype, "v", { value: 9, writable: false });
show("a read-only member above", Reflect.construct(A5, [], T5));
class A6 { v = 1; }
class B6 extends A6 { set v(x) {} }
show("a field (defined, not stored)", new B6());
function A7() { this.v = 1; }
const bound = A7.bind(null); class B7 extends A7 { set v(x) {} }
show("a bound constructor", Reflect.construct(bound, [], B7));
