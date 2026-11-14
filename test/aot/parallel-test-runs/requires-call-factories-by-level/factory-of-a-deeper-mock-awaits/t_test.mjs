import { jest, test } from "bun:test";
// Runs the event loop that many times: jobs, unhandled rejections and immediates run each time, and no clock decides.
const spinEventLoop = async (count = 20) => { while (count-- > 0) await new Promise(done => setImmediate(done)); };
test("t", async () => {
  jest.doMock("./a.mjs", async () => { console.log("a factory"); await 0; return { rate: "aMock" }; });
  jest.doMock("./b.mjs", () => (console.log("b factory"), { rate: "bMock" }));
  const ask = () => { try { return require("./shop.mjs").shown(); } catch (error) { return error.name; } };
  console.log(ask());
  await spinEventLoop();
  console.log(ask());
});
