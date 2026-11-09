// The key is what require.resolve() answers, handed through two more functions of the library. The build knows the name that was asked for, not the file:
// it took the name for the key, found no file under it, and the delete was refused.
import { expect, test } from "bun:test";
import { fileURLToPath, pathToFileURL } from "node:url";

test("the file runs again", () => {
  const first = require("./counter.cjs").runs;
  delete require.cache[fileURLToPath(pathToFileURL(require.resolve("./counter")))];
  expect(require("./counter.cjs").runs).toBe(first + 1);
});
