class Shape {
  get area() { return 7; }
  side() { return 3; }
  static get kind() { return "shape"; }
  static make() { return new Shape(); }
}
const side = Function.prototype.call.bind(Shape.prototype.side); console.log(side(new Shape()), Reflect.apply(Shape.prototype.side, new Shape(), []));
