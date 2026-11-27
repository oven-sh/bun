import { test, vi } from "bun:test";
const told = (load, name) => load.then(all => name + " " + Object.keys(all).join(), error => name + " threw " + error.name);
test("a factory that asks for the original of another file is waited for as before", async () => {
  let calls = 0;
  let asked = "./rates.mjs";
  const factory = async () => {
    calls++;
    return { rate: (await vi.importActual(asked)).rate };
  };
  const inFront = import("./ledger.mjs");
  vi.doMock("./ledger.mjs", factory);
  const behind = import("./ledger.mjs");
  console.log("SAID", await told(inFront, "in front"), "|", await told(behind, "behind"), "|", calls, globalThis.timesRun);
  console.log("SAID", await told(import("./ledger.mjs"), "later"), "|", calls, globalThis.timesRun);
});
