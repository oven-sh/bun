import { test, mock, vi } from "bun:test";
import * as ledger from "./ledger.mjs";
// Runs the event loop that many times: jobs, unhandled rejections and immediates run each time, and no clock decides.
const spinEventLoop = async (count = 20) => { while (count-- > 0) await new Promise(done => setImmediate(done)); };
test("one", async () => {
  vi.doMock("./reader.mjs", () => ({ what: "stand-in reader", read: () => "nothing" }));
  const gate = Promise.withResolvers();
  mock.module("./ledger.mjs", async () => { await gate.promise; return { kind: "stand-in", turn: -1 }; });
  const reader = await vi.importActual("./reader.mjs");
  console.log("SAID meanwhile", reader.what, globalThis.turns);
  gate.resolve();
  await spinEventLoop();
  console.log("SAID settled", reader.read(), ledger.kind, globalThis.turns);
});
