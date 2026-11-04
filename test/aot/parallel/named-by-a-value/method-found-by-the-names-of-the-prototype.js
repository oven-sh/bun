import { inspect } from "node:util";
class Shape {
  side() { return 3; }
  static make() { return new Shape(); }
}
console.log(inspect(Shape.prototype, { showHidden: true }), inspect(Shape, { showHidden: true }));
