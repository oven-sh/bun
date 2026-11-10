import { test } from "bun:test";
import { writeFileSync } from "node:fs";
test("a", async () => {
  console.log("SAID a", (await import("./shared.json")).label);
  writeFileSync(new URL("./shared.json", import.meta.url), `{ "label": "written over" }\n`);
});
