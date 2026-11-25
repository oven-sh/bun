import { test, vi } from "bun:test";
let oils = 0;
// Runs the event loop that many times: jobs, unhandled rejections and immediates run each time, and no clock decides.
const spinEventLoop = async (count = 20) => { while (count-- > 0) await new Promise(done => setImmediate(done)); };
const gate = Promise.withResolvers();
const asked = name => { try { return String(require(name).seen); } catch (error) { return String(error.message).slice(0, 12); } };
test("a", async () => {
  console.log((await import("./stone.mjs")).stone);
  vi.doMock("./stone.mjs", () => ({ stone: "mocked" }));
  vi.doMock("./oil.mjs", async () => { oils++; await gate.promise; throw new Error("oil fails " + oils); });
  console.log(asked("./flask.mjs"));
  vi.doUnmock("./stone.mjs");
  gate.resolve();
  await spinEventLoop();
  console.log(asked("./flask.mjs"), oils);
});
