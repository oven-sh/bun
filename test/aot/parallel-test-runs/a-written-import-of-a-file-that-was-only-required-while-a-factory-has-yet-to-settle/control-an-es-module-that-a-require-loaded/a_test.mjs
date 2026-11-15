// A require() of an ES module goes through the loader, which holds it from then on.
import { mock, test } from "bun:test";
test("one", async () => {
  const required = require("./ledger.mjs");
  mock.module("./ledger.mjs", async () => { await 0; return { kind: "mocked" }; });
  const asked = await import("./ledger.mjs");
  console.log("SAID meanwhile", asked.kind, asked === required, globalThis.turns);
});
