import { test } from "bun:test";
import { run } from "./pool.mjs";
import { describePool } from "./users.ts";
test("the run of the set-up is back", () => {
  console.log("SAID behind it", describePool(), run);
});
