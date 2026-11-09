// The key is what require.resolve() answers, handed through two more functions of the library. The build reads the two as it reads those of node:url, and
// it knows the name that was asked for, not the file: the key is one that it can't tell, and the file leaves the table all the same.
import { expect, test } from "bun:test";

test("the file runs again", () => {
  const first = require("./counter.cjs").runs;
  delete require.cache[Bun.fileURLToPath(Bun.pathToFileURL(require.resolve("./counter")))];
  expect(require("./counter.cjs").runs).toBe(first + 1);
});
