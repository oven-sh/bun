class Shape {
  get area() { return 7; }
  side() { return 3; }
  static get kind() { return "shape"; }
  static make() { return new Shape(); }
}
const call = new Function("object", "name", "return object[name]()"); console.log(call(new Shape(), "side"));
