import { test, vi } from "bun:test";
const told = it => (it.status === "rejected" ? "threw " + it.reason.message : "came " + Object.keys(it.value).join());
test("the calls that wait for one load share its one failure", async () => {
  let calls = 0;
  vi.doMock("./ledger.mjs", async original => { calls++; await original(); throw new Error("refused " + calls); });
  const all = await Promise.allSettled([import("./ledger.mjs"), import("./ledger.mjs"), import("./ledger.mjs")]);
  console.log("SAID", all.map(told).join(" | "), "|", calls, all.every(it => it.reason === all[0].reason), globalThis.timesRun);
  const later = await Promise.allSettled([import("./ledger.mjs")]);
  console.log("SAID", later.map(told).join(), "|", calls, globalThis.timesRun);
});
