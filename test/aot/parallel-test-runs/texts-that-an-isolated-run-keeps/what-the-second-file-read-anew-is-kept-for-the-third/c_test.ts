import { test } from "vitest";
import { writeFileSync } from "node:fs";
test("c", async () => {
  console.log("SAID c", (await import("./shared.ts")).label);
});
