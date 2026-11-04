class Shape {
  get area() { return 7; }
  side() { return 3; }
  static get kind() { return "shape"; }
  static make() { return new Shape(); }
}
class Other {}
for (const name of Reflect.ownKeys(Shape.prototype)) if (name !== "constructor") Object.defineProperty(Other.prototype, name, Object.getOwnPropertyDescriptor(Shape.prototype, name));
console.log(new Other().area, new Other().side());
