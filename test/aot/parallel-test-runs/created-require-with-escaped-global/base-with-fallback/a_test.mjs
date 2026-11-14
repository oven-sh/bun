import { test } from "bun:test";
import { createRequire } from "node:module";

const load = createRequire(process.env.NOBODY_SETS_THIS || import.meta.url);

test("the fallback is the file's own URL", () => {
  console.log(load("./src/user.cjs").describe(1));
});
