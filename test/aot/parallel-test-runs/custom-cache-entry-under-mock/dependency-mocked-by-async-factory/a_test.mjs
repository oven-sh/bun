import { test, vi } from "bun:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const key = require.resolve("./lib.mjs");
const ran = () => (globalThis.ran ?? []).join();
test("the first test file loads the module under a mock below it", async () => {
  vi.doMock("./dep.mjs", () => ({ d: "mocked d" }));
  console.log("SAID first", (await import("./lib.mjs")).seen(), ran());
});
