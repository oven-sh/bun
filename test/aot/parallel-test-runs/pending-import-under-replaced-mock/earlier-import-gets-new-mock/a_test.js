import { test, vi, mock, jest } from "bun:test";
test("t", async () => {
  const gate = Promise.withResolvers(), called = Promise.withResolvers();
  let calls = 0;
  vi.doMock("./m.js", async () => { called.resolve(); await gate.promise; return { x: "old x" }; });
  const first = import("./m.js").then(it => it.x, error => error.constructor.name);
  await called.promise;
  vi.doMock("./m.js", () => { calls++; return { x: "new x" }; });
  const atTheCall = calls;
  const early = (await import("./uses-again.js")).seen;
  gate.resolve();
  const one = await first;
  console.log(`SAID ${one} | ${early} | ${(await import("./m.js")).x} | ${atTheCall} ${calls}`);
});
