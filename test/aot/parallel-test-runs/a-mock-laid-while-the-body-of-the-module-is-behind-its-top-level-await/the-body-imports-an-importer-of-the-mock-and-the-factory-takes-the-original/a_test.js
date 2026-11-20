import { test, vi } from "bun:test";
let open; globalThis.gate = new Promise(done => { open = done; });
const begun = new Promise(tell => { globalThis.tellThatBodyHasBegun = tell; });
test("the body behind its await imports an importer of the mock", async () => {
  const first = import("./a.mjs").then(held => held.get(), error => error.message); await begun;
  vi.doMock("./a.mjs", async original => { const real = await original(); return { get: () => "mocked over " + real.state }; });
  open(); console.log(`| SAID ${await first} | ${globalThis.bodies}`);
}, 3000);
