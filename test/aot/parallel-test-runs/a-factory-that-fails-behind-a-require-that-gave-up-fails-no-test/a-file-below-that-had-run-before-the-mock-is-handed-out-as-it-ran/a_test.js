import { test, vi } from "bun:test";
let calls = 0;
const rest = time => new Promise(done => setTimeout(done, time));
const asked = name => { try { return String(require(name).seen); } catch { return "threw"; } };
test("a", async () => {
  console.log((await import("./lamp.mjs")).seen);
  vi.doMock("./wick.mjs", async () => { calls++; await rest(15); return { width: "mocked " + calls }; });
  console.log(asked("./both.mjs"));
  console.log(asked("./lamp.mjs"));
  await rest(40);
  console.log(asked("./both.mjs"), calls);
});
