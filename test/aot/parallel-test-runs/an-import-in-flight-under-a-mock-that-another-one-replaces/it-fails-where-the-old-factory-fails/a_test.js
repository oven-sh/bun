import { test, vi, mock, jest } from "bun:test";
test("t", async () => {
  const gate = Promise.withResolvers(), called = Promise.withResolvers();
  let calls = 0;
  vi.doMock("./m.js", async () => { called.resolve(); await gate.promise; throw new Error("the old factory fails"); });
  const first = import("./m.js").then(it => it.x, error => error.message);
  await called.promise;
  vi.doMock("./m.js", () => { calls++; return { x: "new x" }; });
  const atTheCall = calls;
  gate.resolve();
  const one = await first;
  const second = (await import("./m.js")).x, third = (await import("./m.js")).x;
  console.log(`SAID ${one} | ${second} | ${third} | ${atTheCall} ${calls}`);
});
