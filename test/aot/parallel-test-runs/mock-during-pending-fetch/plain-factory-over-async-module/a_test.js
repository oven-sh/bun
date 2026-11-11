import { test, vi } from "bun:test";
const within = (promise, name) => Promise.race([promise.then(all => name + " " + Object.keys(all).join() + " " + String(all.early ?? all.seen), error => name + " threw " + error.name), new Promise(done => setTimeout(done, 3000, name + " HUNG"))]);
test("t", async () => {
  let calls = 0;
  const first = import("./module.mjs");
  vi.doMock("./module.mjs", () => { calls++; return { early: "mock", late: "mock", added: 1 }; });
  const second = import("./module.mjs");
  console.log("SAID", await within(first, "first"), "|", await within(second, "second"), "|", calls, globalThis.ran);
  console.log("SAID", await within(import("./module.mjs"), "again"), calls, globalThis.ran);
}, 9000);
