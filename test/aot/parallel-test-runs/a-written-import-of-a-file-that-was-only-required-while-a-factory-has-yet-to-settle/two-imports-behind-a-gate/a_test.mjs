import { mock, test } from "bun:test";
test("one", async () => {
  let calls = 0, open;
  const gate = new Promise(resolve => { open = resolve; });
  console.log("SAID first", require("./ledger.cjs").kind, globalThis.turns);
  const laid = mock.module("./ledger.cjs", async () => { calls++; await gate; return { kind: "mocked" }; });
  const asked = [import("./ledger.cjs"), import("./ledger.cjs")];
  open();
  await laid;
  const found = await Promise.all(asked);
  console.log("SAID meanwhile", found.map(it => it.kind).join(), found[0] === found[1], calls, globalThis.turns);
  console.log("SAID behind", (await import("./ledger.cjs")).kind, require("./ledger.cjs").kind, calls, globalThis.turns);
});
