import { test, vi } from "bun:test";
let open; globalThis.gate = new Promise(done => { open = done; });
const begun = new Promise(tell => { globalThis.tellThatBodyHasBegun = tell; });
test("cell", async () => {
  const first = import("./a.mjs").then(held => held.get() + " | " + held.later, error => "rejects " + error.name); await begun;
  vi.doMock("./a.mjs", async () => { const real = await vi.importActual("./a.mjs"); return { ...real, get: () => "mocked over " + real.state }; });
  open(); console.log(`| SAID ${await first} | ${globalThis.bodies}`);
}, 3000);
