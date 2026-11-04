class Shape {
  get area() { return 7; }
  side() { return 3; }
  static get kind() { return "shape"; }
  static make() { return new Shape(); }
}
const part = globalThis.never ? "x" : "a";
console.log(JSON.stringify.apply(null, [new Shape(), [part + "rea"]]), Reflect.apply(JSON.stringify, null, [new Shape(), [part + "rea"]]));
