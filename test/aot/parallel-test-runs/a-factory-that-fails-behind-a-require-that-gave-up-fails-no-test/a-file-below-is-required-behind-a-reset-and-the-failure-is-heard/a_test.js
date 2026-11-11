import { test, vi } from "bun:test";
let calls = 0;
const rest = time => new Promise(done => setTimeout(done, time));
const asked = name => { try { return String(require(name).seen); } catch { return "threw"; } };
test("a", async () => {
  vi.doMock("./wick.mjs", async () => { calls++; await rest(15); throw new RangeError("the factory fails"); });
  console.log(asked("./shelf.mjs"));
  vi.resetModules();
  console.log(asked("./lamp.mjs"));
  await rest(50);
  console.log("the end", calls);
});
