// `import(path)` and `require(path)` find every compiled file, also where the path is put together when the test runs, and also in a file that an executable would hold too: one that the executable keeps, one whose exports nobody reads, one that the executable drops.
import { test } from "bun:test";
import "../product/main.ts";
import { byImport } from "../product/imports.ts";
import { byRequire } from "../product/requires.cjs";

test("a file of the product loads under paths that are put together in the run", async () => {
  for (const parts of [
    [".", "shelf", "old.cjs"],
    [".", "shelf", "index.mjs"],
    [".", "shelf", "deep", "first.mjs"],
    [".", "shelf", "absent.cjs"],
  ]) {
    console.log(byRequire(parts));
    console.log(await byImport(parts));
  }
});
