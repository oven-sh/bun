class Shape {
  get area() { return 7; }
  side() { return 3; }
  static get kind() { return "shape"; }
  static make() { return new Shape(); }
}
Object.defineProperty(Shape.prototype, "side", { enumerable: true });
for (const name in new Shape()) console.log(name, new Shape()[name]());
