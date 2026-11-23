import { test, vi } from "bun:test";
test("a", async () => {
  globalThis.gate = new Promise(open => { globalThis.open = open; });
  const began = new Promise(r => { globalThis.began = r; });
  globalThis.first = import("./part.mjs"); await began;
  globalThis.own = new Promise(() => {});
  vi.doMock("./part.mjs", async () => { await globalThis.own; return { x: "mock" }; });
  globalThis.second = import("./part.mjs");
  console.log("SAID a");
});
