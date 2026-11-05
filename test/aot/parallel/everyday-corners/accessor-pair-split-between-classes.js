// Accessor pair split between classes: compiled answers as plain.
class A {
  get v() {
    return "A";
  }
}
class B extends A {
  set v(x) {}
}
console.log(new B().v, "v" in new B());
