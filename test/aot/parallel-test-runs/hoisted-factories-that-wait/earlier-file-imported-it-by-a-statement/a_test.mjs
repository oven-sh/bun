import { jest, mock, test, vi } from "bun:test";
import { name } from "./dep.mjs";
test("a", () => {
  console.log("a", name);
});
