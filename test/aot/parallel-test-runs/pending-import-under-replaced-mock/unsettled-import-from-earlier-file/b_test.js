import { test, vi } from "bun:test";
test("the next file", async () => {
  const answer = Promise.withResolvers(), called = Promise.withResolvers();
  vi.doMock("./m.js", () => { called.resolve(); return answer.promise; });
  const first = import("./m.js").then(it => it.x);
  await called.promise;
  vi.doMock("./m.js", () => ({ x: "new x" }));
  answer.resolve({ x: "old x" });
  console.log(`SAID ${await first} | ${(await import("./m.js")).x} | ${(await import("./m.js")).x}`);
});
