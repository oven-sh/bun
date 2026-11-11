import { test, vi } from "bun:test";
test("t", async () => {
  const answer = Promise.withResolvers(), called = Promise.withResolvers();
  vi.doMock("./m.cjs", () => { called.resolve(); return answer.promise; });
  const first = import("./m.cjs");
  await called.promise;
  vi.doMock("./m.cjs", () => ({ x: "new x" }));
  answer.resolve({ x: "old x" });
  console.log("SAID the first import gets " + (await first).x);
  console.log("SAID the next import gets " + (await import("./m.cjs")).x);
  if (globalThis.never) await import("./uses.js");
});
