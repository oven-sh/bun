import { test, vi } from "bun:test";
let calls = 0;
const answer = async promise => { try { return (await promise).a; } catch (error) { return "threw " + error.message; } };
test("t", async () => {
  const called = Promise.withResolvers(), gate = Promise.withResolvers();
  vi.doMock("./part.cjs", async () => { calls++; called.resolve(); await gate.promise; return { a: "mock" }; });
  const opened = answer(import("./part.cjs"));
  await called.promise;
  vi.doUnmock("./part.cjs");
  gate.resolve();
  console.log(`SAID ${await opened} ${await answer(import("./part.cjs"))} ${require("./part.cjs").a} ${calls} ${globalThis.runsOfPart}`);
});
