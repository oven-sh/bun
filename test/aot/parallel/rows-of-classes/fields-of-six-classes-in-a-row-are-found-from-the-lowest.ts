// A class takes the list of fields of its base as a block, and the index of the base with it. Six classes in a row: the first three are too small for an index, the fifth must double it, the sixth copies it.
// `Hides` has a field under a name of the row above, so it takes the fields one by one.
class A { a = 1; }
class B extends A { b = 2; }
class C extends B { c = 3; }
class D extends C { d = 4; }
class E extends D { e = 5; }
class F extends E {
  f = 6;
  sum() { return this.a + this.b * 10 + this.c * 100 + this.d * 1000 + this.e * 10000 + this.f * 100000; }
}
class Hides extends E {
  c = 7;
  sum() { return this.a + this.b * 10 + this.c * 100 + this.d * 1000 + this.e * 10000; }
}
console.log(new F().sum(), new Hides().sum(), new E().e, new D().a, Object.keys(new F()).join(), Object.keys(new Hides()).join());
// A copy is the field of the class that declares it: a store through the highest class is seen through the lowest.
function store(into: A, value: number) { into.a = value; }
const low = new F();
store(low, 9);
store(new A(), 8);
console.log(low.a, low.sum());
