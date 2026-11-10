import { test, mock, vi, jest } from "bun:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const P = "./part.cjs";
test("what lies behind the end", async () => {
  const key = require.resolve(P);
  const held = require(P);
  mock.module(P, () => ({ n: "mock" }));
  delete require.cache[key];
  console.log("SAID taken", key in require.cache, require(P).n, globalThis.runs);
  vi.resetModules();
  console.log("SAID taken", key in require.cache, require(P).n, globalThis.runs);
  vi.doUnmock(P);
  console.log("SAID ended", key in require.cache, require(P).n, require(P) === held, globalThis.runs);
});
