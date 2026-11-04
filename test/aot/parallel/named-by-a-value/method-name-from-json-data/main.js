class Shape {
  get area() { return 7; }
  side() { return 3; }
  static get kind() { return "shape"; }
  static make() { return new Shape(); }
}
import names from "./names.json";
console.log(JSON.stringify(new Shape(), names), names.map(name => typeof new Shape()[name]).join());