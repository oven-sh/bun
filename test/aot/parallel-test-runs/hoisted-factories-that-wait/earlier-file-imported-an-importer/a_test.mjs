import { jest, mock, test, vi } from "bun:test";
import { seen } from "./user.mjs";
test("a", () => {
  console.log("a", seen());
});
