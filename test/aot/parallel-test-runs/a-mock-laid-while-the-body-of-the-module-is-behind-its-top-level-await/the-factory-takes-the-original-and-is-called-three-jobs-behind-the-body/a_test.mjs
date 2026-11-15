import { test, vi } from "bun:test";
// Runs the event loop that many times: jobs, unhandled rejections and immediates run each time, and no clock decides.
const spinEventLoop = async (count = 20) => { while (count-- > 0) await new Promise(done => setImmediate(done)); };
globalThis.jobs = -1;
const said = [];
const begun = Promise.withResolvers(), gate = Promise.withResolvers(), answered = Promise.withResolvers();
globalThis.begin = begun.resolve;
globalThis.gate = gate.promise;
// The numbers are jobs behind the end of the body of a1.mjs. When the calls of import() settle is left out: the first wavers under `bun test`.
test("the jobs behind the body", async () => {
  import("./a1.mjs");
  await begun.promise;
  vi.doMock("./a1.mjs", async original => {
    said.push("called " + globalThis.jobs);
    await original();
    said.push("has the original " + globalThis.jobs);
    await original();
    said.push("again " + globalThis.jobs);
    answered.resolve();
    return { v: "mock" };
  });
  import("./a1.mjs");
  await spinEventLoop();
  gate.resolve();
  await answered.promise;
  console.log("SAID", said.join(" . "));
}, 5000);
