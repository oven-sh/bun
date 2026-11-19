// With "experimentalDecorators" the value of a decorated static field runs behind the class: the name of the class is initialized, and `this` is the one around the class.
import { test } from "bun:test";
function mark(_target: unknown, _key: string) {}
function countNames() { return Registry.names.length; }
function attempt() { try { return String(countNames()); } catch (error: any) { return String(error.name); } }
class Registry {
  static names = ["a", "b"];
  @mark static size = attempt();
  @mark static self = typeof this;
  static plain = typeof this;
}
test("the value of a decorated static field", () => {
  console.log(Registry.size, Registry.self, Registry.plain);
});
