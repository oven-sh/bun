class Shape {
  get area() { return 7; }
  side() { return 3; }
  static get kind() { return "shape"; }
  static make() { return new Shape(); }
}
for (const name of Object.getOwnPropertyNames(Shape.prototype)) if (name !== "constructor") console.log(name, typeof new Shape()[name]);
