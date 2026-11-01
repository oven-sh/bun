// Class field shadows a setter: compiled answers as plain.
class A {
  set v(x) {
    this.seen = x;
  }
}
class B extends A {
  v = 2;
}
const b = new B();
console.log(b.v, b.seen, Object.keys(b).join());
