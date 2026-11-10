import { test, vi } from "bun:test";
let wicks = 0, oils = 0;
const rest = time => new Promise(done => setTimeout(done, time));
const asked = name => { try { return String(require(name).seen); } catch { return "threw"; } };
test("a", async () => {
  vi.doMock("./wick.mjs", async () => { wicks++; await rest(10); throw new RangeError("wick fails " + wicks); });
  vi.doMock("./oil.mjs", async () => { oils++; await new Promise(() => {}); });
  console.log(asked("./pair.mjs"));
  await rest(60);
  console.log("the end", wicks, oils);
});
