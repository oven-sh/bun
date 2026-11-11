import { test, vi } from "bun:test";
let wicks = 0, oils = 0;
const rest = time => new Promise(done => setTimeout(done, time));
const asked = name => { try { return String(require(name).seen); } catch { return "threw"; } };
test("a", async () => {
  vi.doMock("./wick.mjs", async () => { wicks++; await new Promise(() => {}); });
  console.log(asked("./pair.mjs"));
  vi.resetModules();
  vi.doMock("./oil.mjs", async () => { oils++; await rest(15); throw new RangeError("oil fails " + oils); });
  console.log(asked("./pair.mjs"));
  await rest(90);
  console.log("the end", wicks, oils);
});
