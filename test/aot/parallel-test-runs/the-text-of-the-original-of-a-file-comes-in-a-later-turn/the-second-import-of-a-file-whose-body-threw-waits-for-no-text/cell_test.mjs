import { mock, test, vi } from "bun:test";

const tried = async read => {
  try {
    return String(await read());
  } catch (error) {
    return "threw " + error.message;
  }
};

// `bun test` keeps the original that failed and reads no text again: the second import ends in the turn of the first, ahead of the report of the error that nobody hears.
test("both imports end ahead of the report", async () => {
  vi.doMock("./part.mjs", async original => ({ ...(await original()), kind: "over" }));
  console.log("the first import", await tried(async () => (await import("./part.mjs")).kind));
  mock.module("./part.mjs", async () => ({ ...(await vi.importActual("./part.mjs")), kind: "beside" }));
  console.log("the second import", await tried(async () => (await import("./part.mjs")).kind));
  await new Promise(done => setImmediate(done));
  console.log("bodies", globalThis.timesRun);
});
