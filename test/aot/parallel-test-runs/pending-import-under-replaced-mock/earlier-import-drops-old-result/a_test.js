import { test, vi } from "bun:test";
test("t", async () => {
  const answer = Promise.withResolvers(), called = Promise.withResolvers();
  let calls = 0;
  vi.doMock("./m.js", () => { called.resolve(); return answer.promise; });
  const first = import("./m.js").then(it => it.x);
  await called.promise;
  vi.doMock("./m.js", () => { calls++; return { x: "new x" }; });
  const second = answer.promise.then(() => import("./m.js")).then(it => it.x);
  answer.resolve({ x: "old x" });
  const one = await first, two = await second;
  console.log(`SAID ${one} | ${two} | ${(await import("./m.js")).x} ${calls}`);
});
