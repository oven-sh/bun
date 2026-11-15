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
  const first = await opened;
  vi.doMock("./part.mjs", () => ({ a: "second mock" }));
  const second = await answer(import("./part.mjs"));
  vi.doUnmock("./part.mjs");
  console.log(`SAID ${first} ${second} ${await answer(import("./part.mjs"))} ${calls} ${globalThis.runsOfPart}`);
});
