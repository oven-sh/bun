import { test, vi } from "bun:test";
let calls = 0;
const answer = async promise => { try { return (await promise).a; } catch (error) { return "threw " + error.message; } };
test("t", async () => {
  vi.doMock("./part.mjs", () => { calls++; vi.doUnmock("./part.mjs"); return { a: "mock" }; });
  const first = require("./part.mjs").a;
  console.log(`SAID ${first} ${require("./part.mjs").a} ${await answer(import("./part.mjs"))} ${calls} ${globalThis.runsOfPart}`);
});
