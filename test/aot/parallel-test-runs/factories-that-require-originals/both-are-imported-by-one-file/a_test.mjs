import { jest, test } from "bun:test";
// Runs the event loop that many times: jobs, unhandled rejections and immediates run each time, and no clock decides.
const spinEventLoop = async (count = 20) => { while (count-- > 0) await new Promise(done => setImmediate(done)); };
jest.mock("./tax.mjs", () => ({ ...require("./tax.mjs"), rate: "taxMock" }));
jest.mock("./fx.mjs", () => ({ ...jest.requireActual("./fx.mjs"), rate: "fxMock" }));
test("a", async () => {
  const error = await import("./sale.mjs").catch(error => error);
  await spinEventLoop();
  console.log(error.name, await import("./tax.mjs").then(it => [it.rate, it.under()].join()));
});
