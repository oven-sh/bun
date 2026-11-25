import { test, vi, jest, mock, spyOn } from "bun:test";
import * as whole from "./lib.mjs";
test("reads", () => {
  const child = Object.create(whole);
  let sum = 0;
  for (let i = 0; i < 300; i++) { whole.add(1); sum += child.total + child.base + child.twice(i); }
  console.log("SAID", sum);
});
