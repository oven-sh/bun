import { test, vi } from "bun:test";
let calls = 0;
const answer = async promise => { try { return (await promise).a; } catch (error) { return "threw " + error.message; } };
test("u", async () => {
  console.log(`SAID ${await answer(import("./part.mjs"))} ${require("./part.mjs").a} ${globalThis.runsOfPart}`);
});
