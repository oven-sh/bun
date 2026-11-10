// Nothing that a.mjs waits for waits for the factory: vi.importActual() answers once the body of a.mjs has run.
import { test, vi } from "bun:test";
let open; globalThis.gate = new Promise(d => { open = d; });
const begun = new Promise(t => { globalThis.begins = t; });
test("t", async () => {
  const first = import("./a.mjs").then(h => h.get(), e => e.name); await begun;
  vi.doMock("./a.mjs", async () => { const real = await vi.importActual("./a.mjs"); console.log("SAID the factory has", Object.keys(real).join()); return { get: () => "mocked over " + real.state }; });
  const second = import("./b.mjs").then(h => h.read(), e => e.name); await 0; await 0; await 0; await 0; console.log("SAID the gate opens"); open(); console.log(`SAID ${await first} | ${await second} | ${globalThis.bodies}`);
}, 3000);
