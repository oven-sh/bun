// late.json is compiled. The test writes over it under a path that the build cannot read, so the load goes to the file on disk, and the loader is handed the module object of the file that asks.
import { test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
test("t", () => {
  const names = JSON.parse(readFileSync(import.meta.dir + "/names.txt", "utf8"));
  writeFileSync(process.cwd() + names[0], '{"value":"written by the test"}\n');
  const asks = require("./asks.cjs");
  try { console.log("SAID", asks.read()); } catch (error) { console.log("SAID", (error as Error).name); }
});
