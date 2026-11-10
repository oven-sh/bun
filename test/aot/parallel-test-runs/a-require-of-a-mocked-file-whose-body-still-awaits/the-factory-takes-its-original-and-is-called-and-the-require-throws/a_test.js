import { test, vi } from "bun:test";
const said = [];
let open;
globalThis.door = new Promise(done => { open = done; });
const burning = new Promise(told => { globalThis.lit = told; });
test("what a require gives", async () => {
  const first = import("./kiln.mjs");
  await burning;
  vi.doMock("./kiln.mjs", async original => { said.push("factory called"); const real = await original(); said.push("factory has it"); return { look: () => "stand-in over " + real.look() }; });
  try { said.push("require gave " + Object.keys(import.meta.require("./kiln.mjs")).join()); } catch (error) { said.push("require threw " + error.name); }
  open();
  said.push("an import gave " + (await import("./kiln.mjs").then(it => it.look(), error => error.name)));
  console.log("SAID " + said.join(" > "));
});
