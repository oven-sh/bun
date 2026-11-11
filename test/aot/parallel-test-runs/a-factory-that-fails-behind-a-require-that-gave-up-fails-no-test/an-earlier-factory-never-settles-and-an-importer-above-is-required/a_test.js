import { test, vi } from "bun:test";
let wicks = 0, oils = 0;
const rest = time => new Promise(done => setTimeout(done, time));
const asked = name => { try { return String(require(name).seen); } catch { return "threw"; } };
const never = () => new Promise(() => {});
test("a", async () => {
  vi.doMock("./wick.mjs", async () => { wicks++; await never(); });
  console.log(asked("./lamp.mjs"));
  vi.doMock("./wick.mjs", async () => { wicks++; await rest(10); throw new RangeError("the later factory fails"); });
  console.log(asked("./shelf.mjs"));
  await rest(90);
  console.log("the end", wicks, oils);
});
