import { test, vi } from "bun:test";
test("t", async () => {
  for (const turn of [1, 2]) {
    vi.doMock("./part.mjs", async () => ({ kind: "mocked " + turn, seen: (await vi.importActual("./uses.mjs")).sees() }));
    const part = await import("./part.mjs");
    console.log("SAID", part.kind, part.seen, globalThis.runsOfPart, globalThis.runsOfUses);
    vi.doUnmock("./part.mjs");
    vi.resetModules();
  }
});
