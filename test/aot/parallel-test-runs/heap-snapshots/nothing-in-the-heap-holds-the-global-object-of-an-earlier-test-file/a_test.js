import { expect, test } from "bun:test";
import { shelves } from "./shelves.js";

test("lays a mark on its global object", () => {
  globalThis.markOfTheFirstFile = { shelves };
  expect(shelves.length).toBe(2);
});
