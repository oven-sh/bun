class Shape {
  get area() { return 7; }
  side() { return 3; }
  static get kind() { return "shape"; }
  static make() { return new Shape(); }
}
import { inspect } from "node:util";
const data = { get third() { return 3; }, fourth: 4 };
console.log(inspect(data, { getters: true }), inspect(new Shape(), { getters: true, showHidden: true }));
