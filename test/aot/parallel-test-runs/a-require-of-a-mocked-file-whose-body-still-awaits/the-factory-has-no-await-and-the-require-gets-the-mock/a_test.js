import { mock, test, vi } from "bun:test";
const said = (globalThis.said = []);
let open;
globalThis.door = new Promise(done => { open = done; });
const burning = new Promise(told => { globalThis.lit = told; });
test("what a require gives", async () => {
  const first = import("./kiln.mjs");
  await burning;
  vi.doMock("./kiln.mjs", async () => { said.push("factory called"); return { look: () => "stand-in" }; });
  try { said.push("require gave " + import.meta.require("node:util").inspect(import.meta.require("./kiln.mjs").look?.())); } catch (error) { said.push("require threw " + error.name); }
  open();
  said.push("an import gave " + (await import("./kiln.mjs").then(it => it.look(), error => error.name)));
  console.log("SAID " + said.join(" > "));
});
