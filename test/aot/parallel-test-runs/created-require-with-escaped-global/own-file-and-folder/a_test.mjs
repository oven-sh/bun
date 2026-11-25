import { test } from "bun:test";
import { createRequire } from "node:module";

const own = createRequire(import.meta.url);
const inner = createRequire(new URL("./b/", import.meta.url));

test("both requires give one module for one file", () => {
  console.log(own("./a/one.cjs").word, inner("./one.cjs").word, own("./b/one.cjs") === inner("./one.cjs"));
});
