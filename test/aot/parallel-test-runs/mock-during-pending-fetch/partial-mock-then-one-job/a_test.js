import { test, vi } from "bun:test";
const describe = (promise, name) => promise.then(all => name + " " + Object.keys(all).join() + " " + String(all.early ?? all.seen), error => name + " threw " + error.name);
test("t", async () => {
  let calls = 0;
  const first = import("./module.mjs");
  vi.doMock("./module.mjs", async original => { calls++; return { ...(await original()), added: 1 }; });
  await null;
  const second = import("./module.mjs");
  console.log("SAID", await describe(first, "first"), "|", await describe(second, "second"), "|", calls, globalThis.ran);
  console.log("SAID", await describe(import("./module.mjs"), "again"), calls, globalThis.ran);
}, 9000);
