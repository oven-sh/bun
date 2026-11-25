// Guards: toMatchObject() lists through the prototypes. The mark of a compiled class on an object above, a cell of the engine, was found there and handed to a custom equality tester.
import { expect, test } from "bun:test";
class Mine extends Map { #method() { return 1; } call() { return this.#method(); } }
const below = () => Object.create(new Mine());
test("what a tester is handed from above", () => {
  const seen = [];
  expect.addEqualityTesters([(a, b) => { seen.push(typeof a + ":" + typeof b); return undefined; }]);
  expect(below()).toMatchObject(below());
  console.log(new Mine().call(), seen.join());
});
