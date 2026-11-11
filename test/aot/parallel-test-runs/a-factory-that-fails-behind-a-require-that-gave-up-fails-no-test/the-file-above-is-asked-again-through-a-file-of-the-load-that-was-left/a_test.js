import { test, vi } from "bun:test";
let calls = 0;
const rest = time => new Promise(done => setTimeout(done, time));
const asked = name => { try { return String(require(name).seen); } catch { return "threw"; } };
test("a", async () => {
  vi.doMock("./wick.mjs", async () => { calls++; await new Promise(() => {}); });
  console.log(asked("./shelf.mjs"));
  vi.doMock("./wick.mjs", async () => { calls++; await rest(15); return { width: "mocked " + calls }; });
  console.log(asked("./lamp.mjs"));
  console.log(asked("./shelf.mjs"), calls);
});
