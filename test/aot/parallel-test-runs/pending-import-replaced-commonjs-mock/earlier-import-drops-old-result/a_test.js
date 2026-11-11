import { test, vi } from "bun:test";
test("t", async () => {
  const answer = Promise.withResolvers(), called = Promise.withResolvers();
  let calls = 0;
  const word = (load, name) => load.then(it => String(it[name]), error => error.message);
  vi.doMock("./m.cjs", () => { called.resolve(); return answer.promise; });
  const first = word(import("./m.cjs"), "x");
  await called.promise;
  vi.doMock("./m.cjs", () => { calls++; return { x: "new x" }; });
  const go = () => import("./m.cjs");
  const second = word(answer.promise.then(go, go), "x");
  answer.resolve({ x: "old x" });
  const one = await first, two = await second;
  console.log("SAID 0", one, "|", two, "|", await word(import("./m.cjs"), "x"), calls, globalThis.ran ?? "-");
});
