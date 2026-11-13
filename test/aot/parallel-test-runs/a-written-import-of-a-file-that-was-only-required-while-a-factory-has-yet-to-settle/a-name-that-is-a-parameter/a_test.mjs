import { mock, test } from "bun:test";
const ask = name => import(name);
test("one", async () => {
  const required = require("./ledger.cjs");
  mock.module("./ledger.cjs", async () => { await 0; return { kind: "mocked" }; });
  const asked = await ask("./ledger.cjs");
  console.log("SAID meanwhile", asked.kind, asked.default === required, globalThis.turns);
});
