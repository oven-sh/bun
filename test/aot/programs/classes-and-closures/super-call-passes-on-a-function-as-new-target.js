class A { constructor() { this.x = 1; this.seen = this.m(); } m() { return "A.m"; } }
class B extends A { m() { return "B.m"; } }
function G() {}
G.prototype = { m() { return "G.m"; }, z: "z of G" };
function read(o) { return o.z + " " + o.x + " " + o.seen + " " + o.m() + " " + (o instanceof A) + " " + (o instanceof B) + " " + (o instanceof G); }
console.log(read(new A())); console.log(read(new B())); console.log(read(Reflect.construct(B, [], G))); console.log(read(Reflect.construct(A, [], G)));
