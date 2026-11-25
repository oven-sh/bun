import { test } from "bun:test";
test("loads it", () => {
  console.log("SAID first", require("./config.cjs").mode, require("./app.ts").mode());
});
