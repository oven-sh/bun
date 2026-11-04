class Shape {
  get area() { return 7; }
  side() { return 3; }
  static get kind() { return "shape"; }
  static make() { return new Shape(); }
}
const data = { get third() { return 3; }, fourth: 4 };
console.log(data); console.log(new Shape());
