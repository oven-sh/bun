import { test, vi } from "bun:test";
let calls = 0;
const turns = async count => { for (let turn = 0; turn < count; turn++) await 0; };
const asked = () => { try { return require("./lamp.mjs").seen; } catch (error) { return String(error.message).slice(0, 22); } };
test("a", async () => {
  vi.doMock("./wick.mjs", async () => { await 0; throw new Error("fails " + ++calls); });
  console.log(asked());
  await turns(20);
  console.log(await import("./wick.mjs").then(it => it.width, error => error.message));
  console.log(asked(), calls);
});
