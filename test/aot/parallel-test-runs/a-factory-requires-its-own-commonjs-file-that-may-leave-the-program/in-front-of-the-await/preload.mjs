import { vi } from "bun:test";
globalThis.calls = 0;
globalThis.gate = Promise.withResolvers();
vi.mock("./part.cjs", async () => {
  globalThis.calls++;
  const it = require("./part.cjs");
  await globalThis.gate.promise;
  return { x: "mock over " + it.x };
});
