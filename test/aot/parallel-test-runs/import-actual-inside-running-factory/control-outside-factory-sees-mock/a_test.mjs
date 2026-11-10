import { test, vi } from "bun:test";
test("outside a factory the importer sees the mock", async () => {
  vi.doMock("./part.mjs", () => ({ kind: "mocked" }));
  const actual = await vi.importActual("./uses.mjs");
  console.log("SAID", actual.sees(), actual === (await import("./uses.mjs")), globalThis.runsOfPart);
});
