import { test, vi } from "bun:test";
// Runs the event loop that many times: jobs, unhandled rejections and immediates run each time, and no clock decides.
const spinEventLoop = async (count = 20) => { while (count-- > 0) await new Promise(done => setImmediate(done)); };
const say = (name, get) => { try { console.log("SAID " + name + " " + get()); } catch (error) { console.log("SAID " + name + " " + error.name); } };
test("b", async () => {
  vi.doMock("./lib.mjs", () => ({ value: "other", read: () => "other" }));
  let actual = {};
  try { actual = await vi.importActual("./lib.mjs"); console.log("SAID came"); } catch (error) { console.log("SAID rejected " + error.name + " " + error.message); }
  say("value", () => actual.value);
  say("read", () => actual.read());
  await spinEventLoop();
  say("later value", () => actual.value);
  say("later read", () => actual.read());
}, 8000);
