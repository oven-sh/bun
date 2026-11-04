class Shape {
  get area() { return 7; }
  side() { return 3; }
  static get kind() { return "shape"; }
  static make() { return new Shape(); }
}
console.log(JSON.stringify([new Shape()], ["area"]));
