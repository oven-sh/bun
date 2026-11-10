import { test, vi } from "bun:test";
globalThis.jobs = -1;
const said = [];
const wait = ms => new Promise(done => setTimeout(done, ms));
// The numbers are jobs behind the end of the body of a1.mjs. When the calls of import() settle is left out: the first wavers under `bun test`.
test("the jobs behind the body", async () => {
  import("./a1.mjs");
  await wait(5);
  vi.doMock("./a1.mjs", async () => {
    said.push("called " + globalThis.jobs);
    await vi.importActual("./a1.mjs");
    said.push("has the original " + globalThis.jobs);
    return { v: "mock" };
  });
  import("./a1.mjs");
  await wait(90);
  console.log("SAID", said.join(" . "));
}, 5000);
