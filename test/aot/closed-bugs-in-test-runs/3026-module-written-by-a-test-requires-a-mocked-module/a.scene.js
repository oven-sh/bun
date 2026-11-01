import { mock, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
test("a module written at run time requires a mocked module of native code", async () => {
  const real = await import("bun:jsc");
  const heapSize = () => "the mock";
  mock.module("bun:jsc", () => ({ ...real, heapSize }));
  const folder = mkdtempSync(join(import.meta.dir, "written-"));
  try {
    const file = join(folder, "written.cjs");
    writeFileSync(file, 'module.exports = require("bun:jsc").heapSize;');
    const got = require(file);
    console.log("RESULT", typeof got, got === heapSize ? "the mock" : "not the mock");
  } finally { rmSync(folder, { recursive: true, force: true }); }
});
