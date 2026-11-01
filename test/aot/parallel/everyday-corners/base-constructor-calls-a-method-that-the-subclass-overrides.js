// Base constructor calls a method that the subclass overrides: compiled answers as plain.
class A {
  constructor() {
    this.got = this.m();
  }
  m() {
    return "A";
  }
}
class B extends A {
  f = "field";
  m() {
    return "B:" + this.f;
  }
}
console.log(new B().got, new A().got);
