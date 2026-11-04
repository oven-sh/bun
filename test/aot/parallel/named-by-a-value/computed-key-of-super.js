class Shape {
  get area() { return 7; }
  side() { return 3; }
  static get kind() { return "shape"; }
  static make() { return new Shape(); }
}
const part = globalThis.never ? "x" : "a";
class Square extends Shape { read() { return super[part + "rea"]; } } console.log(new Square().read());
