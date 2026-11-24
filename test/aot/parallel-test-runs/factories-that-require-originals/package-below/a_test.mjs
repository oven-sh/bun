import { jest, test } from "bun:test";
// Runs the event loop that many times: jobs, unhandled rejections and immediates run each time, and no clock decides.
const spinEventLoop = async (count = 20) => { while (count-- > 0) await new Promise(done => setImmediate(done)); };
jest.mock("./tax.ts", () => ({ ...require("./tax.ts"), rate: "taxMock" }));
test("a", async () => {
  jest.doMock("@made-up/fx", () => ({ ...jest.requireActual("@made-up/fx"), rate: "fxMock" }));
  const error = await import("./shop.mjs").catch(error => error);
  await spinEventLoop();
  console.log(error.name, await import("./tax.ts").then(it => [it.rate, it.under()].join()));
});
