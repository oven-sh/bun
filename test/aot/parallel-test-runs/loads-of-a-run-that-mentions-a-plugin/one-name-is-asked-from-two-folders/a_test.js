import { plugin } from "bun";
import { test } from "bun:test";
import { createRequire } from "node:module";
test("one name, two folders, one file", () => {
  const below = createRequire(import.meta.dir + "/lib/")("./which.cjs").which;
  const own = require("./which.cjs").which;
  console.log("SAID", below, own, typeof plugin);
});
