import { test, vi } from "bun:test";
test("the original runs for what the factory loads", async () => {
  vi.doMock("./part.mjs", async () => ({ kind: "mocked", loaded: (await vi.importActual("./uses.mjs")).loaded, runs: globalThis.runsOfPart ?? 0 }));
  const part = await import("./part.mjs");
  console.log("SAID", part.kind, part.loaded, part.runs);
});
