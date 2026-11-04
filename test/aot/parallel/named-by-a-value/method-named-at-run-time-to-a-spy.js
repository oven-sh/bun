import { spyOn } from "bun:test";
class Shape {
  side() { return 3; }
}
const shape = new Shape();
const spy = spyOn(shape, "si" + (globalThis.never ? "" : "de"));
console.log(spy.call(shape), spy.mock.calls.length);
