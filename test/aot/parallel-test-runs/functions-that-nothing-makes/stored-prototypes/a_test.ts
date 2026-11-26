import { expect, test } from "bun:test";
import { isShelf, makePlain } from "./shapes.js";

test("functions that nothing makes", () => {
  console.log(isShelf({}), makePlain(4).kind());
  expect(isShelf({})).toBe(false);
  expect(makePlain(4).kind()).toBe("plain 4");
});
