import { test, vi } from "bun:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const key = require.resolve("./lib.cjs");
const ran = () => (globalThis.ran ?? []).join();
test("the first test file loads the module under a mock below it", async () => {
  vi.doMock("./dep.cjs", () => ({ d: "mocked d" }));
  console.log("SAID first", (await import("./lib.cjs")).seen(), ran());
});
