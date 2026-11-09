// The key is what require.resolve() answers, handed through one more function of the library. The build knows the name that was asked for, not the file:
// it took the name for the key, found no file under it, and the delete was refused.
import { expect, test } from "bun:test";
import { normalize } from "node:path";

test("the file runs again", () => {
  const first = require("./counter.cjs").runs;
  delete require.cache[normalize(require.resolve("./counter"))];
  expect(require("./counter.cjs").runs).toBe(first + 1);
});
