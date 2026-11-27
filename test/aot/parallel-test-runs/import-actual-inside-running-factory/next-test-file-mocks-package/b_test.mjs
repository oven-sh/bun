import { test, vi } from "bun:test";
test("t", async () => {
  const first = await import("@made-up/kit877");
  first.bump();
  let actual;
  vi.doMock("@made-up/kit877", async () => {
    actual = await vi.importActual("./other.mjs");
    return { x: actual.counts() };
  });
  const x = (await import("@made-up/kit877")).x;
  first.bump();
  console.log("SAID b", x, globalThis.runs, actual.counts());
}, 5000);
