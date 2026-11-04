class Shape {
  get area() { return 7; }
  side() { return 3; }
  static get kind() { return "shape"; }
  static make() { return new Shape(); }
}
const part = globalThis.never ? "x" : "a";
function call(object, name) { return object[name](); } console.log(call(new Shape(), "si" + (globalThis.never ? "" : "de")));
