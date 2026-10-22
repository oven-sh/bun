class Base { #p = 1; p() { return this.#p; } static hasP(o) { return #p in o; } }
const M = B => class extends B { #q = 2; q() { return this.#q; } setQ(v) { this.#q = v; } static hasQ(o) { return #q in o; } };
const X = M(Base);
const Y = M(Base);
const x = new X();
const y = new Y();
x.setQ(5);
console.log(x.p(), x.q(), y.p(), y.q(), Base.hasP(x), X.hasQ(x), X.hasQ(y), Y.hasQ(y), Base.hasP(new Base()), X.hasQ(new Base()));
