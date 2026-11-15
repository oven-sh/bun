import { test } from "bun:test";
import { writeFileSync } from "node:fs";
test("d", async () => {
  console.log("SAID d", (await import("./above.ts")).look());
});
