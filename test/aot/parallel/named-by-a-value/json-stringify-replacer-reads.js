class Shape {
  get area() { return 7; }
  side() { return 3; }
  static get kind() { return "shape"; }
  static make() { return new Shape(); }
}
const part = globalThis.never ? "x" : "a";
console.log(JSON.stringify({ shape: 1 }, function (key, value) { return key ? new Shape()[part + "rea"] : value; }));
