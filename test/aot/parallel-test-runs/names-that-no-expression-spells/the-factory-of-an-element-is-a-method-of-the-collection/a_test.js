import { test, expect } from "bun:test";
import { Crate, look } from "./crate.js";
test("the element reads the entry out of the collection", () => {
  const crate = new Crate(7);
  console.log(crate.read(), look(crate), look({}));
  expect(look(crate)).toBe(7);
});
