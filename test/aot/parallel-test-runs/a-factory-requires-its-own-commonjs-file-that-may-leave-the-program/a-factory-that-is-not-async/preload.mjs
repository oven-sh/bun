import { vi } from "bun:test";
globalThis.calls = 0;
globalThis.gate = Promise.withResolvers();
vi.mock("./part.cjs", () => {
  globalThis.calls++;
  const it = require("./part.cjs");
  return { x: "mock over " + it.x };
});
