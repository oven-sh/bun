import { mock, test } from "bun:test";
const name = (process.env.MADE_UP_NONE ?? "./ledger") + ".cjs";
test("one", async () => {
  const required = require("./ledger.cjs");
  mock.module("./ledger.cjs", async () => { await 0; return { kind: "mocked" }; });
  const asked = await import(name);
  console.log("SAID meanwhile", asked.kind, asked.default === required, globalThis.turns);
});
