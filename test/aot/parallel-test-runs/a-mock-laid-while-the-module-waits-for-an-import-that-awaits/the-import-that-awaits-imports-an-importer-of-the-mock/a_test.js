// a.mjs is being imported and waits for d.mjs, which awaits: the body of a.mjs has yet to begin when the mock is laid on it. The import under way still gets the module, whose body runs in its turn, beside the mock. b.mjs, imported behind the mock, gets the mock.
import { test, vi } from "bun:test";
let open; globalThis.gate = new Promise(d => { open = d; });
const begun = new Promise(t => { globalThis.begins = t; });
test("t", async () => {
  const first = import("./a.mjs").then(h => h.get(), e => e.name); await begun;
  vi.doMock("./a.mjs", () => ({ get: () => "mocked" }));
  open(); console.log(`SAID ${await first} | ${globalThis.bodies}`);
}, 3000);
