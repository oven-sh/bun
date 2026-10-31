// Prototype of a class changed after: compiled answers as plain.
class A {
  m() {
    return "A";
  }
}
class C {
  m() {
    return "C";
  }
}
class B extends A {
  m() {
    return "B>" + super.m();
  }
}
const b = new B();
console.log(b.m());
Object.setPrototypeOf(B.prototype, C.prototype);
console.log(b.m(), b instanceof A, b instanceof C);
