import { test, vi } from "bun:test";
const later = ms => new Promise(done => setTimeout(done, ms));
globalThis.log = [];
const hung = setTimeout(() => { console.log("SAID still waiting"); process.exit(4); }, 3000);
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
    await later(50);
    const real = await vi.importActual("./kiln.mjs");
    globalThis.log.push("factory has " + real.glaze);
    return { look: () => "stand-in over " + real.glaze };
  });
  const early = import("./shelf.mjs").then(it => it.read(), error => error.name);
  open();
  await later(100);
  openSecond();
  const stands = later(700).then(() => "stands");
  const original = await Promise.race([first, stands]);
  const said = globalThis.shelf ? await Promise.race([globalThis.shelf, stands]) : "none";
  console.log("SAID early", await Promise.race([early, stands]));
  console.log("SAID", said, "|", original, "|", globalThis.firings);
  console.log("SAID LOG " + globalThis.log.join(" > "));
  clearTimeout(hung);
}, 5000);
