// A mixin with a private field is applied twice to a base with a private field, and once to its own result: each evaluation has private names of its own.
class Base { #p = 5; p() { return this.#p; } static hasP(o) { return #p in o; } }
const M = (B) => class extends B { #q = 1; q() { return this.#q; } setQ(n) { this.#q = n; return this; } static hasQ(o) { return #q in o; } static readQ(o) { return o.#q; } static writeQ(o, n) { o.#q = n; } };
const X = M(Base), Y = M(Base), Z = M(X);
const x = new X, y = new Y, z = new Z;
console.log(x.p(), x.q(), Base.hasP(x), X.hasQ(x), Y.hasQ(x), Z.hasQ(x));
console.log(y.p(), y.setQ(7).q(), Base.hasP(y), X.hasQ(y), Y.hasQ(y), Z.hasQ(y));
console.log(z.p(), z.q(), Base.hasP(z), X.hasQ(z), Y.hasQ(z), Z.hasQ(z), Object.keys(z).length);
let thrown = "no error";
try { X.readQ(y); } catch (error) { thrown = error instanceof TypeError; }
Z.writeQ(z, 9);
console.log(thrown, X.readQ(z), Z.readQ(z), z.q(), X.readQ(x), Y.readQ(y));
console.log(Base.hasP(Reflect.construct(Base, [], X)), X.hasQ(Reflect.construct(Base, [], X)), Reflect.construct(Base, [], X) instanceof X, X.hasQ(Reflect.construct(X, [], Base)), Reflect.construct(X, [], Y) instanceof Y);
