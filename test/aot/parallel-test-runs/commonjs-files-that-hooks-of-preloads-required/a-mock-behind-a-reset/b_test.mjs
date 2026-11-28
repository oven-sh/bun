import { test } from "bun:test";
test("the next test file gets the run of the hook", async () => {
  console.log((await import("./user.cjs")).ask());
});
