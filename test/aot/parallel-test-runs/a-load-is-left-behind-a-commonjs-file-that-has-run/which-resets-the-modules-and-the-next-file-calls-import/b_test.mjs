import { test } from "bun:test";
test("b", async () => {
  console.log((await import("./root.mjs")).r);
});
