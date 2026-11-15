import { test, vi, jest, mock, spyOn } from "bun:test";
import { twice, base } from "./lib.mjs";
import * as whole from "./lib.mjs";
test("reads", async () => {
  let sum = 0;
  for (let i = 0; i < 300; i++) sum += whole.base + twice(i) + base;
  await mock.module("./lib.mjs", () => ({ base: 100, twice: () => 1 }));
  let after = 0;
  for (let i = 0; i < 300; i++) after += whole.base + twice(i) + base + whole.twice(i);
  console.log("SAID", sum, after);
});
