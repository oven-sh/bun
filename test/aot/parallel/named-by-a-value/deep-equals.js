class Shape {
  get area() { return 7; }
  side() { return 3; }
  static get kind() { return "shape"; }
  static make() { return new Shape(); }
}
import { deepStrictEqual } from "node:assert";
const data = { get third() { return 3; } };
deepStrictEqual(data, { third: 3 }); console.log(Bun.deepEquals(data, { third: 3 }), Bun.deepMatch({ area: 7 }, new Shape()));
