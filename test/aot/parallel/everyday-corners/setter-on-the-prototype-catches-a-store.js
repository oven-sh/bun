// Setter on the prototype catches a store: compiled answers as plain.
class A {
  set v(x) {
    this._v = x * 2;
  }
  get v() {
    return this._v;
  }
}
class B extends A {
  constructor() {
    super();
    this.v = 2;
  }
}
console.log(new B().v, Object.keys(new B()).join());
