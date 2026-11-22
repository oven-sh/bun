import { test, vi } from "bun:test";
const later = ms => new Promise(done => setTimeout(done, ms));
let open;
globalThis.door = new Promise(done => { open = done; });
const burning = new Promise(told => { globalThis.lit = told; });
test("t", async () => {
  const first = import("./kiln.mjs").then(it => it.look(), error => error.name);
  await burning;
  vi.doMock("./kiln.mjs", async original => {
    const real = await original();
    return { look: () => "stand-in over " + real.glaze };
  });
  globalThis.extra = vi.importActual("./ledge.mjs");
  globalThis.shelf = vi.importActual("./ledge.mjs").then(it => it.read());
  open();
  await later(100);
  const stands = later(700).then(() => "stands");
  const original = await Promise.race([first, stands]);
  const said = await Promise.race([globalThis.shelf, stands]);
  // Whether the ring stands or the factory gets the half-run original wavers under `bun test`. That ledge.mjs never reads the original itself does not.
  console.log("SAID ledge.mjs reads the half-run original itself:", said === "kiln wet", "| bodies", globalThis.firings);
}, 5000);
