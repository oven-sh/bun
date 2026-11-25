import { test } from "bun:test";
import { writeFileSync } from "node:fs";
test("c", async () => {
  console.log("SAID c", JSON.stringify((await import("./shared.md")).default));
});
