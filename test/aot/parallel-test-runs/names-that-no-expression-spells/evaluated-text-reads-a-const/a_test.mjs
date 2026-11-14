import { test, expect } from "bun:test";
import { Crate } from "./crate.mjs";
test("evaluated text finds the entry in the collection", () => {
  const crate = new Crate(7);
  console.log(crate.read(), crate.peek());
  expect(crate.peek()).toBe(true);
});
