import { test, vi } from "bun:test";
// Runs the event loop that many times: jobs, unhandled rejections and immediates run each time, and no clock decides.
const spinEventLoop = async (count = 20) => { while (count-- > 0) await new Promise(done => setImmediate(done)); };
test("a", async () => {
  let tell, goOn;
  const hasBegun = new Promise(resolve => { tell = resolve; });
  globalThis.tellThatBodyHasBegun = tell;
  globalThis.mayGoOn = new Promise(resolve => { goOn = resolve; });
  const ask = () => import("./part.mjs").then(all => Object.keys(all).join(), error => error.name);
  const first = ask();
  await hasBegun;
  vi.doMock("./part.mjs", async original => { const own = original(); await null; return { mocked: 1, held: typeof own }; });
  const second = ask();
  goOn();
  const said = [await first, await second];
  said.push(await ask());
  await spinEventLoop();
  console.log("SAID", said.join(" | "));
}, 5000);
