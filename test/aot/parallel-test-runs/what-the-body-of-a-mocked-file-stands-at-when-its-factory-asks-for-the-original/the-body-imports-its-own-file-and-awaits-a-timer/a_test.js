import { test, vi } from "bun:test";
globalThis.log = [];
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
    globalThis.log.push("factory called");
    const real = await vi.importActual("./kiln.mjs");
    globalThis.log.push("factory has " + real.glaze);
    return { look: () => "stand-in over " + real.glaze };
  });
  open();
  openSecond();
  const original = await first;
  const said = globalThis.shelf ? await globalThis.shelf : "none";
  console.log("SAID", said, "|", original, "|", globalThis.firings);
  console.log("SAID LOG " + globalThis.log.join(" > "));
}, 5000);
