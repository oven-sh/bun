import { test, vi } from "bun:test";
let calls = 0;
const rest = time => new Promise(done => setTimeout(done, time));
const asked = name => { try { return String(require(name).seen); } catch { return "threw"; } };
test("a", async () => {
  vi.doMock("./wick.mjs", async () => { calls++; await new Promise(() => {}); });
  console.log(asked("./lamp.mjs"));
  vi.doUnmock("./wick.mjs");
  vi.doMock("./wick.mjs", async () => { calls++; await rest(15); throw new RangeError("wick fails " + calls); });
  console.log(asked("./spark.mjs"));
  await rest(90);
  console.log("the end", calls);
});
