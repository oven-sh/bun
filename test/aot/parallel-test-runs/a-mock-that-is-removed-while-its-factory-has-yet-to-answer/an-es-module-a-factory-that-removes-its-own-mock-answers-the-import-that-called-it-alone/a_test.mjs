import { test, vi } from "bun:test";
let calls = 0;
const answer = async promise => { try { return (await promise).a; } catch (error) { return "threw " + error.message; } };
test("t", async () => {
  vi.doMock("./part.mjs", () => { calls++; vi.doUnmock("./part.mjs"); return { a: "mock" }; });
  console.log(`SAID ${await answer(import("./part.mjs"))} ${await answer(import("./part.mjs"))} ${require("./part.mjs").a} ${calls} ${globalThis.runsOfPart}`);
});
