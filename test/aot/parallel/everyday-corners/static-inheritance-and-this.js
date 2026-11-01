// Static inheritance and this: compiled answers as plain.
class A {
  static make() {
    return new this();
  }
  static who() {
    return this.name;
  }
}
class B extends A {}
console.log(B.make() instanceof B, B.who(), A.make() instanceof B, Object.getPrototypeOf(B) === A);
