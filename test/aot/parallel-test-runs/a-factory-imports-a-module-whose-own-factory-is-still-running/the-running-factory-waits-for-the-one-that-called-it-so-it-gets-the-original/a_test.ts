import { test, vi } from "bun:test";
// Runs the event loop that many times: jobs, unhandled rejections and immediates run each time, and no clock decides.
const spinEventLoop = async (count = 20) => { while (count-- > 0) await new Promise(done => setImmediate(done)); };
// An import of a fresh file goes through the whole loader: when four have come in turn, one that was requested before them has arrived.
let pebble = 0;
const settle = async () => { for (let count = 0; count < 4; count++) await import(`./pebble${pebble++}.ts`); await spinEventLoop(); };
const call = { r: Promise.withResolvers<void>(), a: Promise.withResolvers<void>(), b: Promise.withResolvers<void>() };
const gate = { r: Promise.withResolvers<void>(), a: Promise.withResolvers<void>(), b: Promise.withResolvers<void>() };
test("three factories", async () => {
  vi.doMock("./r.ts", async () => { call.r.resolve(); await gate.r.promise; const other = await import("./a.ts"); return { r: "mocked r < " + other.a }; });
  vi.doMock("./a.ts", async () => { call.a.resolve(); await gate.a.promise; const other = await import("./b.ts"); return { a: "mocked a < " + other.b }; });
  vi.doMock("./b.ts", async () => { call.b.resolve(); await gate.b.promise; const other = await import("./r.ts"); return { b: "mocked b < " + other.r }; });
  const early = [import("./uses-r.ts"), import("./uses-a.ts"), import("./r-and-a.ts")];
  await call.r.promise;
  await call.a.promise;
  await settle();
  gate.r.resolve();
  await settle();
  gate.a.resolve();
  await call.b.promise;
  await settle();
  void import("./b-and-r.ts");
  await settle();
  gate.b.resolve();
  for (const held of await Promise.all(early)) console.log("SAID", held.seen);
});
