import { expect, test, vi } from "bun:test";
import { look } from "./user.mjs";
vi.mock("./shapes.mjs", () => ({ square: 3 }));
test("one member is read", () => {
  console.log("SAID", look());
  expect(look()).toBe("5");
});
