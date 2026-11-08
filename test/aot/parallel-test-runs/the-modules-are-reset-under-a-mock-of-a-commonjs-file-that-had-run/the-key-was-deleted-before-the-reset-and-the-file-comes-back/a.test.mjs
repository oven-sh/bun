import { mock, test, vi } from "bun:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
test("what lies behind the end", async () => {
  const key = require.resolve("./part.cjs");
  const held = require("./part.cjs");
  mock.module("./part.cjs", () => ({ n: "mock" }));
  console.log("SAID laid", require("./part.cjs").n, globalThis.runs);
  delete require.cache[key];
  vi.resetModules();
  console.log("SAID taken", key in require.cache, require("./part.cjs").n, globalThis.runs);
  vi.doUnmock("./part.cjs");
  console.log(
    "SAID ended",
    key in require.cache,
    require("./part.cjs").n,
    require("./part.cjs") === held,
    globalThis.runs,
  );
  console.log("SAID imported", (await import("./part.cjs")).n, globalThis.runs);
});
