import { jest, mock, test, vi } from "bun:test";
import { createRequire } from "node:module";
// Runs the event loop that many times: jobs, unhandled rejections and immediates run each time, and no clock decides.
const spinEventLoop = async (count = 20) => { while (count-- > 0) await new Promise(done => setImmediate(done)); };
let answered = Promise.withResolvers();
mock.module("./tax.cjs", async () => { try { return { ...(await import("./tax.cjs")), rate: 9 }; } finally { answered.resolve(); } });
const require = createRequire(import.meta.url);
const call = async deed => { try { return String(await deed()); } catch (error) { return "threw " + error.name; } };
const safe = async deed => { try { return await deed(); } catch (error) { return { rate: "threw " + error.name + " " + error.message.slice(0, 12) }; } };
async function say(name, it) {
  if (it?.then) it = await it;
  console.log("SAID", name, await call(() => Object.keys(it).sort().join()), await call(() => it.rate), await call(() => it.fee()), await call(() => it.show()), await call(() => it.default?.fee?.()), await call(() => it.early));
}
test("a", async () => {
  await say("mocked", await safe(() => import("./tax.cjs")));
  answered = Promise.withResolvers();
  await say("required", await safe(() => require("./tax.cjs")));
  // Nobody hears that the factory behind the require() fails: the test fails by it, and the run ends.
  await answered.promise;
  await spinEventLoop();
  console.log("SAID user", await call(async () => (await import("./user.mjs")).used()), await call(() => require("./user.cjs").used()));
  const actual = await safe(() => vi.importActual("./tax.cjs"));
  await say("actual", actual);
  const own = await safe(() => jest.requireActual("./tax.cjs"));
  await say("actual required", own);
  console.log("SAID same", actual === (await safe(() => vi.importActual("./tax.cjs"))), own === (await safe(() => jest.requireActual("./tax.cjs"))), actual?.fee === own?.fee);
  vi.doUnmock("./tax.cjs");
  await say("back", await safe(() => import("./tax.cjs")));
  await say("back required", await safe(() => require("./tax.cjs")));
});
