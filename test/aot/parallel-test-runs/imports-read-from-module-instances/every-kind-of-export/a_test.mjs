import { test, vi, jest, mock, spyOn } from "bun:test";
import named, { add, twice, total, base, Box } from "./lib.mjs";
import * as whole from "./lib.mjs";
test("reads", () => {
  let sum = 0;
  for (let i = 0; i < 300; i++) sum += twice(i) + add(1) + total + base + whole.base + whole.twice(i) + new Box(i).value + new whole.Box(i).value + named().length + whole.default().length;
  console.log("SAID", sum, whole.add === add, whole.Box === Box, whole.default === named);
});
