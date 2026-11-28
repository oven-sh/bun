import { test } from "bun:test";
test("b", async () => {
  console.log(require("./root.mjs").r);
});
