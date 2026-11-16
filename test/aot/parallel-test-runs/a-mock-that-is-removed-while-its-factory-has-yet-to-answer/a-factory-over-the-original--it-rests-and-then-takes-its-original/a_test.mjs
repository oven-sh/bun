import { test, vi } from "bun:test";
let open, hasComeSoFar;
const gate = new Promise(done => (open = done));
const soFar = new Promise(done => (hasComeSoFar = done));
test("t", async () => {
  vi.doMock("./mill.mjs", async original => {
    hasComeSoFar();
    await gate;
    const real = await original();
    return { ...real, grain: "mock over " + real.grain };
  });
  vi.doMock("./oven.mjs", async () => {
    const mill = await import("./mill.mjs");
    return { loaf: "loaf of " + mill.grain };
  });
  const load = import("./oven.mjs").then(
    it => it.loaf,
    () => "rejected",
  );
  await soFar;
  vi.doUnmock("./mill.mjs");
  open();
  console.log("SAID the load under way", await load);
  console.log("SAID a later load", (await import("./mill.mjs")).grain);
});
