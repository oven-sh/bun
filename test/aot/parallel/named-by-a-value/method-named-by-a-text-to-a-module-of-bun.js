class Shape {
  get area() { return 7; }
  side() { return 3; }
  static get kind() { return "shape"; }
  static make() { return new Shape(); }
}
import { mock } from "node:test";
const shape = new Shape(); const mocked = mock.method(shape, "side"); console.log(shape.side(), mocked.mock.callCount());
