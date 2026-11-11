import { test, vi } from "bun:test";
test("t", async () => {
  const first = await import("./k.mjs");
  first.bump();
  let actual;
  vi.doMock("./k.mjs", async () => {
    actual = await vi.importActual("./second.mjs");
    return { x: actual.counts() };
  });
  const x = (await import("./k.mjs")).x;
  first.bump();
  console.log("SAID b", x, globalThis.runs, actual.counts());
}, 5000);
