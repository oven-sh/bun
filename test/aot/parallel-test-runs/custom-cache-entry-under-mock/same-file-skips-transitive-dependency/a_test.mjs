import { test, vi } from "bun:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const key = require.resolve("./lib.mjs");
const ran = () => (globalThis.ran ?? []).join();
test("one test file", async () => {
  vi.doMock("./dep.mjs", () => ({ d: "mocked d" }));
  console.log("SAID loaded", require("./lib.mjs").seen(), ran());
  vi.doMock("./lib.mjs", async () => { await 0; return { a: "mocked" }; });
  vi.doUnmock("./dep.mjs");
  require.cache[key] = { exports: { a: "fake" } };
  console.log("SAID stored", ran());
  delete require.cache[key];
  const actual = await vi.importActual("./lib.mjs");
  console.log("SAID asked", actual.a, actual.seen(), ran());
});
