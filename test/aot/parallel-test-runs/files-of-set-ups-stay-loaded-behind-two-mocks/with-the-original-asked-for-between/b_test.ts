import { test } from "bun:test";
test("b", () => {
  console.log("SAID", require("./users.ts").find(), require("./pool.cjs").id);
});
