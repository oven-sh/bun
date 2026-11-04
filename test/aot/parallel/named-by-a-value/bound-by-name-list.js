class Shape {
  get area() { return 7; }
  side() { return 3; }
  static get kind() { return "shape"; }
  static make() { return new Shape(); }
}
const shape = new Shape(); for (const name of ["side"]) shape[name] = shape[name].bind(shape); const { side } = shape; console.log(side());
