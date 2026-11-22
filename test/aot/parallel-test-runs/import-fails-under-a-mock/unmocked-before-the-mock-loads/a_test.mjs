import { test, vi } from "bun:test";
const nextMacrotask = () => new Promise(resolve => setImmediate(resolve));
const describe = promise => promise.then(it => it.value + ", " + it.call(), error => "rejected with " + error.name);
test("the module fails while a mock is registered over it", async () => {
  let open;
  globalThis.gate = new Promise(resolve => {
    open = resolve;
  });
  const started = new Promise(resolve => {
    globalThis.reportStart = resolve;
  });
  const first = describe(import("./part.mjs"));
  await started;
  await nextMacrotask();
  vi.doMock("./part.mjs", () => ({ value: "mock", call: () => "mock call" }));
  const second = describe(import("./part.mjs"));
  for (let tick = 0; tick < 3; tick++) await null;
  vi.doUnmock("./part.mjs");
  open();
  console.log("first:", await first);
  console.log("second:", await second);
  await nextMacrotask();
  console.log("later:", await describe(import("./part.mjs")));
  console.log("later again:", await describe(import("./part.mjs")));
  console.log("evaluations:", globalThis.evaluations);
});
