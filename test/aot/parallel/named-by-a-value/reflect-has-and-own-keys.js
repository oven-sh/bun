class Shape {
  get area() { return 7; }
  side() { return 3; }
  static get kind() { return "shape"; }
  static make() { return new Shape(); }
}
const part = globalThis.never ? "x" : "a";
console.log(Reflect.has(new Shape(), part + "rea"), Reflect.ownKeys(Shape.prototype).join(), Reflect.ownKeys(Shape.prototype).map(key => typeof Shape.prototype[key]).join());
