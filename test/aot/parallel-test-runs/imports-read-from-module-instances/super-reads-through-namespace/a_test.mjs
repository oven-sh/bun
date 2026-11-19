import { test, vi, jest, mock, spyOn } from "bun:test";
import * as whole from "./lib.mjs";
test("reads", () => {
  const child = { __proto__: whole, get base() { return super.base + 1; }, sum() { let sum = 0; for (let i = 0; i < 300; i++) { whole.add(1); sum += super.total + super.base; } return sum; } };
  console.log("SAID", child.sum(), child.base);
});
