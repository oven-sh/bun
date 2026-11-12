import { mock, test } from "bun:test";
import { show, workshop } from "./workshop.js";
const made = (name, kind, pos, end) => globalThis.shops[name].make(kind, pos, end);
test("what the first file left, and a workshop of this file", () => {
  console.log("b 1", show(made("first", 1, 2, 3)), show(made("second", 1, 2, 3)));
  const third = (globalThis.shops.third = workshop("third"));
  third.Leaf.prototype = { set end(value) { console.log("b third sets end", value); }, get end() { return "above"; } };
  for (let i = 0; i < 3; i++) console.log("b 2", show(made("third", i, i + 1, i + 2)));
});
test("under a mock", async () => {
  mock.module("./workshop.js", () => ({ workshop: label => ({ make: kind => ({ mocked: label, kind }) }), show: JSON.stringify }));
  const mocked = await import("./workshop.js");
  console.log("b 3", mocked.show(mocked.workshop("mocked").make(1)));
  console.log("b 4", show(made("third", 7, 8, 9)), show(workshop("fourth").make(1, 2, 3)));
});
