import { test, expect } from "bun:test";
import { held, make } from "./shelves.mjs";
test("the conversion of the first key puts another function in the helper's place", () => {
  const before = held();
  const Shelf = make();
  console.log(new Shelf().count(), before === held());
  expect(before === held()).toBe(false);
});
