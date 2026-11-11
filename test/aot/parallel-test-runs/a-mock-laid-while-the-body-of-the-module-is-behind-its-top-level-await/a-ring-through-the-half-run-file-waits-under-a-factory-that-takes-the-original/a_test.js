import { test, vi } from "bun:test";
const wait = ms => new Promise(done => setTimeout(done, ms));
const within = (promise, name, ms) => Promise.race([promise, new Promise(done => setTimeout(done, ms, name + " waits"))]);
test("t", async () => {
  globalThis.gate = new Promise(done => { globalThis.openGate = done; });
  globalThis.tick = new Promise(done => { globalThis.passTick = done; });
  const kiln = import("./kiln.mjs");
  await wait(20);
  vi.doMock("./kiln.mjs", async () => {
    await globalThis.tick;
    const real = await within(vi.importActual("./kiln.mjs"), "original", 1200);
    return { name: typeof real === "string" ? "mock, " + real : "mock, original given" };
  });
  const asked = vi.importActual("./shelf.mjs");
  await wait(20);
  globalThis.openGate();
  await wait(20);
  globalThis.passTick();
  console.log("SAID r0", await within(asked.then(m => m.shelf), "asked", 3000), "|", await within(kiln.then(m => m.held), "kiln", 1000));
}, 9000);
