import { test, vi } from "bun:test";
let open, tell;
const gate = new Promise(done => {
  open = done;
});
const told = new Promise(done => {
  tell = done;
});
test("a", async () => {
  console.log("SAID first " + (await import("./clay.mjs")).name);
  vi.doMock("./clay.mjs", async () => {
    const own = await vi.importActual("./clay.mjs");
    for (let turn = 0; turn < 3; turn++) await null;
    return { ...own, name: "mock clay" };
  });
  console.log("SAID " + (await Promise.all([import("./clay.mjs"), import("./clay.mjs")])).map(each => each.name).join(", "));
}, 3000);
