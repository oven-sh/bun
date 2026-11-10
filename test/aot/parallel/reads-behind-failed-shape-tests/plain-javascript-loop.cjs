function probe(x) { let s = ""; for (let i = 0; i < 2; i++) { s += x.a; if (typeof x !== "number") s += "/" + x.a; } return s; }
class A { constructor(v) { this.a = v; this.z = 1; } }
class B { constructor(v) { this.b = v; } }
class C { constructor(v) { this.c = v; } }
const odd = new A(5); delete odd.z;
const all = [new A(1), new B(2), new C(3), odd, 4];
for (let i = 0; i < all.length; i++) console.log(probe(all[i]));
