import { jest, test, vi } from "bun:test";
test("t", async () => {
  vi.doMock("./part.mjs", async () => ({ kind: "mocked", seen: (await vi.importActual("./uses.mjs")).sees() }));
  const part = await import("./part.mjs");
  console.log("SAID", part.kind, part.seen, globalThis.runsOfUses);
  vi.doMock("./uses.mjs");
  const mocked = await import("./uses.mjs");
  console.log("SAID", typeof mocked.sees, mocked.sees(), jest.requireActual("./uses.mjs").sees(), globalThis.runsOfUses);
});
