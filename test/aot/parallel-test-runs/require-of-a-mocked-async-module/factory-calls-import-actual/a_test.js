import { test, vi } from "bun:test";
const lines = [];
let open;
globalThis.gate = new Promise(resolve => { open = resolve; });
test("a later import gets the mock", async () => {
  open();
  vi.doMock("./kiln.mjs", async () => { lines.push("factory called"); const real = await vi.importActual("./kiln.mjs"); lines.push("factory has it"); return { look: () => "stand-in over " + real.look() }; });
  try { lines.push("require gave " + Object.keys(import.meta.require("./kiln.mjs")).join()); } catch (error) { lines.push("require threw " + error.name); }
  open();
  lines.push("an import gave " + (await import("./kiln.mjs").then(it => it.look(), error => error.name)));
  console.log(lines.join(" > "));
});
