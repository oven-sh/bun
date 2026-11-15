import { test } from "bun:test";
import { writeFileSync } from "node:fs";
test("a", async () => {
  console.log("SAID a", JSON.stringify((await import("./shared.md")).default));
  writeFileSync(new URL("./shared.md", import.meta.url), `# written over\n`);
});
