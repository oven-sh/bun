import { test, vi } from "bun:test";
test("t", async () => {
  const gate = Promise.withResolvers(), called = Promise.withResolvers();
  let calls = 0;
  vi.doMock("./m.cjs", async () => { called.resolve(); await gate.promise; return { x: "old x" }; });
  const first = import("./m.cjs").then(it => it.x, error => error.constructor.name);
  await called.promise;
  vi.doMock("./m.cjs", () => { calls++; return { x: "new x" }; });
  gate.resolve();
  for (let job = 0; job < 8; job++) await null;
  const required = require("./m.cjs").x;
  await first;
  const second = (await import("./m.cjs")).x, third = require("./m.cjs").x;
  console.log(`SAID ${required} | ${second} | ${third} | ${calls}`);
});
