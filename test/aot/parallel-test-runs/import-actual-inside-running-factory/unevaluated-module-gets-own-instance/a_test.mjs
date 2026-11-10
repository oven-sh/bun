import { test, vi } from "bun:test";
globalThis.log = [];
test("t", async () => {
  vi.doMock("./k.mjs", () => ({ x: "mocked" }));
  await import("./k.mjs");
  const actual = await vi.importActual("./k.mjs");
  actual.bump();
  vi.doUnmock("./k.mjs");
  const before = actual.count();
  const again = await import("./k.mjs");
  console.log("SAID", log.join(" "), "|", before, actual.count(), again.count(), actual === again);
}, 5000);
