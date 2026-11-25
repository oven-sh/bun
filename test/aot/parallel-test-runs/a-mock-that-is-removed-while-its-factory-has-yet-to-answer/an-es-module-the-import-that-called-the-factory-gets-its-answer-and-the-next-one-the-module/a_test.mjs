import { test, vi } from "bun:test";
let calls = 0;
const answer = async promise => { try { return (await promise).a; } catch (error) { return "threw " + error.message; } };
test("t", async () => {
  const called = Promise.withResolvers(), gate = Promise.withResolvers();
  vi.doMock("./part.mjs", async () => { calls++; called.resolve(); await gate.promise; return { a: "mock" }; });
  const opened = answer(import("./part.mjs"));
  await called.promise;
  vi.doUnmock("./part.mjs");
  gate.resolve();
  console.log(`SAID ${await opened} ${await answer(import("./part.mjs"))} ${require("./part.mjs").a} ${calls} ${globalThis.runsOfPart}`);
});
