import { test } from "bun:test";
import { writeFileSync } from "node:fs";
test("a", async () => {
  console.log("SAID a", JSON.stringify((await import("./shared.txt")).default));
  writeFileSync(new URL("./shared.txt", import.meta.url), `written over`);
});
