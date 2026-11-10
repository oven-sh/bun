import { test, vi } from "bun:test";
let calls = 0;
const answer = async promise => { try { return (await promise).a; } catch (error) { return "threw " + error.message; } };
test("t", async () => {
  vi.doMock("./part.mjs", async () => { calls++; await 0; vi.doUnmock("./part.mjs"); return { a: "mock" }; });
  console.log(`SAID ${await answer(import("./part.mjs"))} ${await answer(import("./part.mjs"))} ${calls} ${globalThis.runsOfPart}`);
});
