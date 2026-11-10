import { test, vi } from "bun:test";
test("t", async () => {
  vi.doMock("./part.cjs", async () => ({ kind: "mocked", seen: (await vi.importActual("./uses-cjs.mjs")).sees() }));
  const part = await import("./part.cjs");
  console.log("SAID", part.kind, part.seen, globalThis.runsOfPart, globalThis.runsOfUses);
  console.log("SAID", (await import("./uses-cjs.mjs")).sees(), globalThis.runsOfPart, globalThis.runsOfUses);
});
