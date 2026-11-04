import { mock } from "node:test";
class Shape {
  side() { return 3; }
}
const shape = new Shape();
const mocked = mock.method(shape, "si" + (globalThis.never ? "" : "de"));
console.log(mocked.call(shape), mocked.mock.callCount());
