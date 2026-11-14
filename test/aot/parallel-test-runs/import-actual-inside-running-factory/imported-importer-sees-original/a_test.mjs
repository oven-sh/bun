import { test, vi } from "bun:test";
test("what the factory loads sees the original", async () => {
  vi.doMock("./part.mjs", async () => ({ kind: "mocked", seen: (await vi.importActual("./uses.mjs")).sees() }));
  const part = await import("./part.mjs");
  console.log("SAID", part.kind, part.seen, globalThis.runsOfPart);
});
