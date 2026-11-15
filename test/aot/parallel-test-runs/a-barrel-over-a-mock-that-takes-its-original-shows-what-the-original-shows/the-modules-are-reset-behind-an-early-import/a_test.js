import { test, vi } from "bun:test";
test("one", async () => {
  const early = await import("./porch.js");
  vi.doMock("./gauge.mjs", () => ({ default: 1, held: 10 }));
  vi.doMock("./shelf.js", async original => ({ ...(await original()), added: 1 }));
  vi.resetModules();
  console.log("SAID", globalThis.runs ?? 0, (await import("./reader.js")).look());
  console.log("SAID early", Object.keys(early).sort().join());
});
