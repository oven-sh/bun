import { test } from "bun:test";
test("u", async () => {
  console.log("SAID", (await import("./part.mjs")).x, require("./part.mjs").x);
});
