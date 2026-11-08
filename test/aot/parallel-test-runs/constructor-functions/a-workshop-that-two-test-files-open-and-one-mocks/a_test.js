import { test } from "bun:test";
import { show, workshop } from "./workshop.js";
globalThis.shops = {};
const made = (name, kind, pos, end) => globalThis.shops[name].make(kind, pos, end);
test("the first and a second", () => {
  globalThis.shops.first = workshop("first");
  for (let i = 0; i < 50; i++) made("first", i, i + 1, i + 2);
  console.log("a 1", show(made("first", 1, 2, 3)));
  const second = (globalThis.shops.second = workshop("second"));
  Object.defineProperty(second.Leaf.prototype, "pos", { set(value) { console.log("a second sets pos", value); }, get() { return "above"; }, configurable: true });
  console.log("a 2", show(made("second", 4, 5, 6)));
  console.log("a 3", show(made("first", 7, 8, 9)));
});
test("a setter comes above the first", () => {
  Object.defineProperty(globalThis.shops.first.Leaf.prototype, "id", { set(value) { console.log("a first sets id", value); }, get() { return "above"; }, configurable: true });
  console.log("a 4", show(made("first", 1, 2, 3)));
});
