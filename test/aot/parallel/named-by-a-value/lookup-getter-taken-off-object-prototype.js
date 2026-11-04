class Shape {
  get area() { return 7; }
  side() { return 3; }
  static get kind() { return "shape"; }
  static make() { return new Shape(); }
}
const part = globalThis.never ? "x" : "a";
console.log(Object.prototype.__lookupGetter__.call(new Shape(), part + "rea").call(new Shape()));
