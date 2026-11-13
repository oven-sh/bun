import { test } from "bun:test";
test("c", async () => {
  console.log("SAID c", (await import("./user.mjs")).user());
});
