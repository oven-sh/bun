// A bundle is required, taken out of the cache and required again: its body runs again and makes its wrappers again, and each wrapper runs its callback once more: new classes,
// new variables. The marks of a test run lie on the record of the file alone: what is written in a wrapper runs at most once only where the file around it does.
import { test } from "bun:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
test("a bundle that is required again", () => {
  const path = require.resolve("./bundle.cjs");
  const first = require("./bundle.cjs");
  const one = first.make(1);
  delete require.cache[path];
  const second = require("./bundle.cjs");
  const two = second.make(2);
  console.log("SEEN", first === second, first.Point === second.Point, first.runs(), second.runs());
  console.log("SEEN", one instanceof first.Point, one instanceof second.Point, two instanceof first.Point, two instanceof second.Point);
  console.log("SEEN", Object.getPrototypeOf(one) === first.Point.prototype, Object.getPrototypeOf(two) === second.Point.prototype, first.Point.prototype === second.Point.prototype);
  console.log("SEEN", first.Point.has(one), first.Point.has(two), second.Point.has(one), second.Point.has(two));
  console.log("SEEN", one.sum(), two.sum(), first.count(), second.count(), first.Point.made, second.Point.made);
  first.make(3);
  console.log("SEEN", first.count(), second.count(), first.Point.made, second.Point.made);
});
