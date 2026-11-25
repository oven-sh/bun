import { test, vi } from "bun:test";
test("x", async () => {
  let open; globalThis.gate = new Promise(r => { open = r; });
  const began = new Promise(r => { globalThis.began = r; });
  const keys = v => Object.keys(v).sort().map(k => k + "=" + String(v[k])).join(",");
  const first = import("./part.mjs"); await began;
  vi.doMock("./part.mjs", { spy: true });
  const second = import("./part.mjs");
  open();
  console.log("SAID", keys(await first), "&", keys(await second));
});
