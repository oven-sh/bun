import { test, mock, vi } from "bun:test";
import * as ledger from "./ledger.mjs";
test("one", async () => {
  vi.doMock("./reader.mjs", () => ({ what: "stand-in reader", read: () => "nothing" }));
  const gate = Promise.withResolvers();
  mock.module("./ledger.mjs", async () => { await gate.promise; return { kind: "stand-in", turn: -1 }; });
  const reader = await vi.importActual("./reader.mjs");
  console.log("SAID meanwhile", reader.what, globalThis.turns);
  gate.resolve();
  await new Promise(resolve => setTimeout(resolve, 5));
  console.log("SAID settled", reader.read(), ledger.kind, globalThis.turns);
});
