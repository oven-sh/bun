import { test, vi } from "bun:test";
// Runs the event loop that many times: jobs, unhandled rejections and immediates run each time, and no clock decides.
const spinEventLoop = async (count = 20) => { while (count-- > 0) await new Promise(done => setImmediate(done)); };
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
  const first = import("./rack.mjs").then(it => it.seen(), error => error.name);
  await burning;
  vi.doMock("./kiln.mjs", async () => {
    globalThis.log.push("factory called");
    await spinEventLoop();
    const real = await vi.importActual("./kiln.mjs");
    globalThis.log.push("factory has " + real.glaze);
    return { look: () => "stand-in over " + real.glaze };
  });
  const early = import("./shelf.mjs").then(it => it.read(), error => error.name);
  open();
  openSecond();
  const original = await first;
  const said = globalThis.shelf ? await globalThis.shelf : "none";
  console.log("SAID early", await early);
  console.log("SAID", said, "|", original, "|", globalThis.firings);
  console.log("SAID LOG " + globalThis.log.join(" > "));
});
