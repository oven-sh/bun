import { test } from "bun:test";
test("the file behind the one that is not linked runs", () => {
  console.log("the next file runs");
});
