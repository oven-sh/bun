class Shape {
  get area() { return 7; }
  side() { return 3; }
  static get kind() { return "shape"; }
  static make() { return new Shape(); }
}
const table = { first: "area", second: "side" }; for (const which in table) console.log(typeof new Shape()[table[which]]);
