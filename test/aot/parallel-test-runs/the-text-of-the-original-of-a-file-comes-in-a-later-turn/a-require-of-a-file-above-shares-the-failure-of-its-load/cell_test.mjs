import { test, vi } from "bun:test";
import pull from "./pull.cjs";

const told = it => (it.status === "rejected" ? "threw " + it.reason.message : "came " + Object.keys(it.value).join());

// The require asks for a file that imports the mocked one: a load that fails. The two calls that wait for the mocked file share that failure.
test("the factory is called once", async () => {
  let calls = 0;
  vi.doMock("./ledger.mjs", original => {
    calls++;
    throw new Error("refused " + calls);
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
  console.log("later", (await Promise.allSettled([import("./ledger.mjs")])).map(told).join(), "calls", calls, "bodies", String(globalThis.timesRun));
});
