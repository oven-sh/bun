import { test, vi } from "bun:test";
// Runs the event loop that many times: jobs, unhandled rejections and immediates run each time, and no clock decides.
const spinEventLoop = async (count = 20) => { while (count-- > 0) await new Promise(done => setImmediate(done)); };
// An import of a fresh file goes through the whole loader: when four have come in turn, one that was requested before them has arrived.
let pebble = 0;
const settle = async () => { for (let count = 0; count < 4; count++) await import(`./pebble${pebble++}.ts`); await spinEventLoop(); };
const r = Promise.withResolvers<void>(), x = Promise.withResolvers<void>();
test("first", async () => {
  vi.doMock("./r.ts", async () => { r.resolve(); await new Promise(() => {}); return { r: "never" }; });
  vi.doMock("./x.ts", async () => { x.resolve(); await null; await import("./r.ts"); return { x: "first x" }; });
  import("./uses-r.ts"); import("./uses-x.ts"); import("./both.ts");
  await r.promise; await x.promise; await settle(); console.log("SAID first is over");
});
test("second", async () => {
  vi.doMock("./x.ts", async () => { await spinEventLoop(); return { x: "second x" }; });
  vi.doMock("./r.ts", async () => { await null; const other = await import("./x.ts"); return { r: "mocked r < " + other.x }; });
  const held = await Promise.all([import("./uses-x-again.ts"), import("./uses-r-again.ts"), import("./both-again.ts")]);
  console.log("SAID second", held.map(each => each.seen).join(" | "));
});
