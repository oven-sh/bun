import { test } from "vitest";
import { writeFileSync } from "node:fs";
test("b", async () => {
  console.log("SAID b", (await import("./shared.ts")).label);
});
