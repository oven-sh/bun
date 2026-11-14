import { test, vi, jest, mock, spyOn } from "bun:test";
import { total, add, base } from "./barrel.mjs";
import * as whole from "./barrel.mjs";
test("reads", () => {
  let sum = 0;
  for (let i = 0; i < 300; i++) { add(1); sum += total + whole.total + base + whole.base + whole.own; }
  console.log("SAID", sum);
});
