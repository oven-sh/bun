// Nothing of it reaches the next test file.
import { test, vi, mock } from "bun:test";
let open; globalThis.gate = new Promise(d => { open = d; });
const begun = new Promise(t => { globalThis.begins = t; });
test("t", async () => {
  const first = import("./a.mjs").then(h => h.get(), e => e.name + ": " + e.message); await begun;
  vi.doMock("./a.mjs", () => { console.log("SAID factory runs"); return { get: () => "mocked" }; });
  open(); console.log("SAID", await first, globalThis.bodies);
}, 3000);
