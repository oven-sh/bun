import { test, vi } from "bun:test";
test("the module is loaded", async () => {
  const { go } = await import("./user");
  console.log("SAID b", go());
});
