// With "experimentalDecorators" the value of a decorated field is code of the constructor: it runs behind the parameters and has the constructor's new.target.
import { test } from "bun:test";
const order: string[] = [];
function note<T>(label: string, value: T): T { order.push(label); return value; }
function mark(_target: unknown, _key: string) {}
class Gauge {
  plain = note("plain field", 0);
  @mark level = note("decorated field", 1);
  @mark made = new.target === undefined ? "undefined" : (new.target as any).name;
  constructor(step = note("parameter", 1)) { order.push("body"); }
}
test("the value of a decorated field", () => {
  console.log(new Gauge().made, order.join(" < "));
});
