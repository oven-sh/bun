import { test, vi } from "bun:test";
let open, tell;
const gate = new Promise(done => {
  open = done;
});
const told = new Promise(done => {
  tell = done;
});
test("both were called before the factory was", async () => {
  vi.doMock("./clay.mjs", async () => {
    tell();
    await gate;
    return { name: "mock clay" };
  });
  const both = Promise.all([import("./clay.mjs"), import("./clay.mjs")]);
  await told;
  open();
  console.log("SAID " + (await both).map(each => each.name).join(", "));
}, 3000);
