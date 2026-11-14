import { test } from "bun:test";

test("an earlier file requires the counter", () => {
  console.log("a", require("./counter.cjs").increment());
});
