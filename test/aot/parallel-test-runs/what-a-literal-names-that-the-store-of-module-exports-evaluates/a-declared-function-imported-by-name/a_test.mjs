import { test } from "bun:test";
import { sum } from "./sum.cjs";
test("sum", () => {
  console.log(sum(1, 2));
});
