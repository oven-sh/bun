import { test, vi } from "bun:test";
let open, tell;
const gate = new Promise(done => {
  open = done;
});
const told = new Promise(done => {
  tell = done;
});
test("the file that wrote the factory asks while it runs", async () => {
  vi.doMock("./clay.mjs", async original => {
    const real = await original();
    tell();
    await gate;
    return { ...real, name: "mock clay" };
  });
  const first = import("./clay.mjs");
  await told;
  const second = await import("./clay.mjs");
  console.log("SAID while the factory waits: " + second.name);
  open();
  console.log("SAID " + (await first).name + ", " + second.name + ", one object made: " + ((await first).made === second.made));
}, 3000);
