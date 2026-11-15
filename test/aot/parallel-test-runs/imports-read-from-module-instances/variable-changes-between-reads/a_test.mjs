import { test, vi, jest, mock, spyOn } from "bun:test";
import { add, total } from "./lib.mjs";
import * as whole from "./lib.mjs";
test("reads", () => {
  let seen = 0;
  for (let i = 0; i < 300; i++) { add(1); seen += total + whole.total; }
  console.log("SAID", seen, total, whole.total);
});
