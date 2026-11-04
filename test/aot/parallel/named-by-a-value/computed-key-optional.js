class Shape {
  get area() { return 7; }
  side() { return 3; }
  static get kind() { return "shape"; }
  static make() { return new Shape(); }
}
const part = globalThis.never ? "x" : "a";
console.log(new Shape()?.[part + "rea"], new Shape()["si" + (globalThis.never ? "" : "de")]?.());
