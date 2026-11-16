import { test, vi } from "bun:test";
let open; globalThis.gate = new Promise(d => { open = d; });
const begun = new Promise(t => { globalThis.begins = t; });
test("t", async () => {
  const first = import("./a.mjs").then(h => h.get(), e => e.name); await begun;
  vi.doMock("./a.mjs", async () => { const real = await vi.importActual("./a.mjs"); return { get: () => "mocked over " + real.state }; });
  open(); console.log(`| SAID ${await first} | ${globalThis.bodies}`);
}, 3000);
