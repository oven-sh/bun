// This test file lays no mock.
import { test } from "bun:test";
test("a", async () => {
  const { look } = await import("./user.mjs");
  console.log("SAID a", look());
});
