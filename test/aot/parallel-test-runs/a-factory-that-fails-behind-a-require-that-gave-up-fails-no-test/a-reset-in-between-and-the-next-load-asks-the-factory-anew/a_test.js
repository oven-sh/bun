import { test, vi } from "bun:test";
const note = word => { globalThis.runs = (globalThis.runs ?? "") + word + " "; };
const turns = async count => { for (let turn = 0; turn < count; turn++) await 0; };
let fails = true;
test("a", () => {
  vi.doMock("./wick.mjs", async () => {
    note("f");
    await 0;
    if (fails) throw new RangeError("the factory fails");
    return { width: "mock" };
  });
  try { note(require("./lamp.mjs").seen); } catch (error) { note(error.constructor.name); }
  vi.resetModules();
});
test("b", async () => {
  await turns(40);
  fails = false;
  note(await import("./lamp.mjs").then(it => it.seen, error => error.constructor.name));
  console.log(globalThis.runs);
});
