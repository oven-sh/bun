import { test, vi } from "bun:test";
const { answer, called } = vi.hoisted(() => ({ answer: Promise.withResolvers(), called: Promise.withResolvers() }));
vi.mock("./m.cjs", () => { called.resolve(); return answer.promise; });
test("t", async () => {
  let calls = 0;
  const word = (load, name) => Promise.resolve(load).then(it => String(it[name]), error => error.message);
  const first = word(import("./m.cjs"), "x");
  await called.promise;
  vi.doMock("./m.cjs", () => { calls++; return { x: "new x" }; });
  const go = () => import("./m.cjs");
  const second = word(answer.promise.then(() => 0, () => 0).then(() => 0, () => 0).then(() => 0, () => 0).then(go, go), "x");
  answer.resolve({ x: "old x" });
  const one = await first, two = await second;
  console.log("SAID 3", one, "|", two, "|", await word(import("./m.cjs"), "x"), calls, globalThis.ran ?? "-");
});
