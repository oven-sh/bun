import { test, vi } from "bun:test";
let open, tell;
const gate = new Promise(done => {
  open = done;
});
const told = new Promise(done => {
  tell = done;
});
test("the file that wrote the factory asks while it runs", async () => {
  console.log("SAID first: " + (await import("./clay.mjs")).name);
  vi.doMock("./clay.mjs", async () => {
    tell();
    await gate;
    return { name: "mock clay" };
  });
  const first = import("./clay.mjs");
  await told;
  const second = await import("./clay.mjs");
  console.log("SAID while the factory waits: " + second.name);
  open();
  console.log("SAID " + (await first).name + ", " + second.name);
  console.log("SAID behind its end: " + (await import("./clay.mjs")).name);
}, 3000);
