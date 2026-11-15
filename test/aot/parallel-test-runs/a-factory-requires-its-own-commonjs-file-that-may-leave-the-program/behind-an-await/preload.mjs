import { vi } from "bun:test";
globalThis.calls = 0;
globalThis.gate = Promise.withResolvers();
vi.mock("./part.cjs", async () => {
  globalThis.calls++;
  await globalThis.gate.promise;
  const it = require("./part.cjs");
  return { x: "mock over " + it.x };
});
