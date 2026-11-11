import { test, vi } from "bun:test";
test("a", async () => {
  globalThis.gate = new Promise((open, fail) => { globalThis.open = open; globalThis.fail = fail; });
  const began = new Promise(r => { globalThis.began = r; });
  globalThis.first = import("./part.mjs"); globalThis.first.catch(() => {}); await began;
  vi.doMock("./part.mjs", async original => ({ ...(await original()), x: "mock" }));
  globalThis.second = import("./part.mjs"); globalThis.second.catch(() => {});
  console.log("SAID a");
});
