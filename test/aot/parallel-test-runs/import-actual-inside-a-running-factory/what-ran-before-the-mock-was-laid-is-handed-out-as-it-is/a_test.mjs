import { test, vi } from "bun:test";
test("what ran before the mock is asked for by the factory", async () => {
  const first = await import("./uses.mjs");
  let same;
  vi.doMock("./part.mjs", async () => { const actual = await vi.importActual("./uses.mjs"); same = actual === first; return { kind: "mocked", seen: actual.sees() }; });
  const part = await import("./part.mjs");
  console.log("SAID", part.kind, part.seen, same, globalThis.runsOfUses);
});
