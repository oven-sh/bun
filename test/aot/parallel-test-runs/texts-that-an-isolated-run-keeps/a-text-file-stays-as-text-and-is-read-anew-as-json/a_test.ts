import { test } from "bun:test";
import { writeFileSync } from "node:fs";
test("a", async () => {
  console.log("SAID a", JSON.stringify([(await import("./shared.txt")).default, (await import("./shared.txt", { with: { type: "json" } })).default]));
  writeFileSync(new URL("./shared.txt", import.meta.url), `{ "label": "written over" }`);
});
