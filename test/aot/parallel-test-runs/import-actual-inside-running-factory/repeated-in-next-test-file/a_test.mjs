import { test, vi } from "bun:test";
test("t", async () => {
  const first = await import("./k.mjs");
  first.bump();
  let actual;
  vi.doMock("./k.mjs", async () => {
    actual = await vi.importActual("./other.mjs");
    return { x: actual.counts() };
  });
  const x = (await import("./k.mjs")).x;
  console.log("SAID a", x, globalThis.runs);
}, 5000);
