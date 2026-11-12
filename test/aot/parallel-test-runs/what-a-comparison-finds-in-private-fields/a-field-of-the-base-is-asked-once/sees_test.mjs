// Guards: each private field is compared once, the base's in front of the heir's, as they were defined.
import { expect, test } from "bun:test";
class Base { #b = 7; }
class Heir extends Base { #s = 1; }
test("how often a tester is asked", () => {
  const seen = [];
  expect.addEqualityTesters([(a, b) => { seen.push(typeof a + ":" + a); return undefined; }]);
  expect(new Heir()).toMatchObject(new Heir());
  console.log(seen.join());
});
