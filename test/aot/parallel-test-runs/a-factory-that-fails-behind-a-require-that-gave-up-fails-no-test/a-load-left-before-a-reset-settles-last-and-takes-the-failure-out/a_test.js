import { test, vi } from "bun:test";
const sleep = ms => new Promise(done => setTimeout(done, ms));
const tried = name => { try { require(name); return "answered"; } catch { return "threw"; } };
let calls = 0;
test("a", async () => {
  vi.doMock("./wick.mjs", async () => { await sleep(100); return { width: "mocked" }; });
  console.log(tried("./lamp.mjs"));
  vi.resetModules();
  vi.doMock("./oil.mjs", async () => { calls++; await sleep(20); throw new Error("oil fails " + calls); });
  console.log(tried("./flask.mjs"));
  await sleep(200);
  console.log(await import("./flask.mjs").then(it => it.seen, error => error.message), calls);
});
