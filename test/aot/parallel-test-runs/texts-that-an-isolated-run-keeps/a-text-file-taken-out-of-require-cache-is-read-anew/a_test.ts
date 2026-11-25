import { test } from "bun:test";
import { writeFileSync } from "node:fs";
test("a", async () => {
  console.log("SAID a", JSON.stringify(require("./shared.txt")));
  writeFileSync(new URL("./shared.txt", import.meta.url), `written over`);
});
