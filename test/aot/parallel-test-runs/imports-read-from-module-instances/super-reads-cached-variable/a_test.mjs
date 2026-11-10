import { test, vi, jest, mock, spyOn } from "bun:test";
import * as whole from "./lib.mjs";
test("reads", () => {
  const child = { __proto__: whole, sum() { let sum = 0; for (let i = 0; i < 3000; i++) { whole.add(1); sum += whole.total + whole.base + super.total + super.base + super.twice(i); } return sum; } };
  console.log("SAID", child.sum());
});
