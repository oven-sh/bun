import { test } from "bun:test";
import { writeFileSync } from "node:fs";
test("c", async () => {
  console.log("SAID c", JSON.stringify([(await import("./shared.txt")).default, (await import("./shared.txt", { with: { type: "json" } })).default]));
});
