import { test, vi } from "bun:test";
import pull from "./pull.cjs";

const told = it => (it.status === "rejected" ? "threw " + it.reason.message : "came " + Object.keys(it.value).join());

// The factory throws once, to the require. Nothing of that failure is kept: the two calls that wait call the factory again.
test("the calls that wait do not hear the error of the require", async () => {
  let calls = 0;
  vi.doMock("./ledger.mjs", original => {
    calls++;
    if (calls === 1) throw new Error("refused " + calls);
    return { good: calls };
  });
  const held = [import("./ledger.mjs"), import("./ledger.mjs")];
  let pulled;
  try {
    pull();
    pulled = "came";
  } catch (error) {
    pulled = "threw " + error.message;
  }
  console.log("the require", pulled);
  (await Promise.allSettled(held)).forEach((it, at) => console.log("call", at, told(it)));
  console.log("calls", calls, "bodies", String(globalThis.timesRun));
});
