import { test } from "bun:test";
test("the run of the set-up is back", () => {
  console.log("SAID behind it", require("./users.ts").describePool(), require("./pool.mjs").run);
});
