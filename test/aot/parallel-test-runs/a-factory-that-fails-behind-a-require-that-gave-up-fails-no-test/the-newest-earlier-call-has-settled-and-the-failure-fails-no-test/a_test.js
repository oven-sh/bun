import { test, vi } from "bun:test";
let wicks = 0, oils = 0;
const rest = time => new Promise(done => setTimeout(done, time));
const asked = name => { try { return String(require(name).seen); } catch { return "threw"; } };
const never = () => new Promise(() => {});
test("a", async () => {
  vi.doMock("./wick.mjs", async () => { wicks++; await never(); });
  console.log(asked("./lamp.mjs"));
  vi.doMock("./wick.mjs", async () => { wicks++; await rest(5); return { width: "second" }; });
  console.log(asked("./torch.mjs"));
  await rest(40);
  vi.doMock("./wick.mjs", async () => { wicks++; await rest(15); throw new RangeError("the third factory fails"); });
  console.log(asked("./spark.mjs"));
  await rest(90);
  console.log("the end", wicks, oils);
});
