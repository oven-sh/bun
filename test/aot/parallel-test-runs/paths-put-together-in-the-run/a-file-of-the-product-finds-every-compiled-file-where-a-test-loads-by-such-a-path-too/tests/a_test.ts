// `import(path)` and `require(path)` find every compiled file, also where the path is put together when the test runs, and also in a file that an executable would hold too: one that the executable keeps, one whose exports nobody reads, one that the executable drops.
import { test } from "bun:test";
import "../product/main.ts";
import { byImport } from "../product/imports.ts";
import { byRequire } from "../product/requires.cjs";

// A file of the tests loads under such a path too. Where only files of the product do, they find what the build found, as in the executable:
// ../../../a-load-written-in-the-product-finds-in-a-test-run-what-it-finds-in-the-executable.test.ts.
const byRequireOfTest = (parts: string[]) => Object.keys(require(parts.join("/"))).sort().join();

test("a file of the product loads under paths that are put together in the run", async () => {
  console.log("the test itself:", byRequireOfTest(JSON.parse('["..", "product", "shelf", "old.cjs"]')));
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
