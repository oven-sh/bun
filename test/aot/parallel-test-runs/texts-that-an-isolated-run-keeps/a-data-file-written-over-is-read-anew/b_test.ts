import { test } from "bun:test";
import { writeFileSync } from "node:fs";
test("b", async () => {
  console.log("SAID b", (await import("./shared.json")).label);
});
