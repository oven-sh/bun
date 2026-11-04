class Shape {
  get area() { return 7; }
  side() { return 3; }
  static get kind() { return "shape"; }
  static make() { return new Shape(); }
}
const { constructor, ...all } = Object.getOwnPropertyDescriptors(Shape.prototype); console.log(Object.keys(all).join(), Object.values(all).map(found => (found.get ?? found.value).call(new Shape())).join());
