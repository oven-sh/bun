import { test, vi } from "bun:test";
test("t", async () => {
  vi.doMock("./part.mjs", async () => ({ kind: "mocked", seen: (await vi.importActual("./uses.mjs")).sees() }));
  const part = await import("./part.mjs");
  console.log("SAID", part.kind, part.seen, globalThis.runsOfPart, globalThis.runsOfUses);
  console.log("SAID", (await import("./uses.mjs")).sees(), globalThis.runsOfPart, globalThis.runsOfUses);
});
