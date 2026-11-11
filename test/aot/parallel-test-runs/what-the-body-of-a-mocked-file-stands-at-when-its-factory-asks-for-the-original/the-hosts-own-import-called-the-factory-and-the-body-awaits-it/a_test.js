import { test, vi } from "bun:test";
const later = ms => new Promise(done => setTimeout(done, ms));
let open;
let openSecond;
globalThis.door = new Promise(done => { open = done; });
globalThis.secondDoor = new Promise(done => { openSecond = done; });
const burning = new Promise(told => { globalThis.lit = told; });
globalThis.fetchShelf = () => {
  globalThis.shelf = import("./shelf.mjs").then(it => it.read());
  return globalThis.shelf;
};
test("what the body stands at", async () => {
  const first = import("./kiln.mjs").then(it => it.look(), error => error.name);
  await burning;
  vi.doMock("./kiln.mjs", async () => {
    const real = await vi.importActual("./kiln.mjs");
    return { look: () => "stand-in over " + real.glaze };
  });
  globalThis.shelf = vi.importActual("./ledge.mjs").then(it => it.read());
  open();
  await later(100);
  openSecond();
  const stands = later(700).then(() => "stands");
  const original = await Promise.race([first, stands]);
  const said = globalThis.shelf ? await Promise.race([globalThis.shelf, stands]) : "none";
  console.log("SAID", said, "|", original, "|", globalThis.firings);
}, 5000);
