import { test, vi, jest, mock } from "bun:test";
const say = (step, ...all) => console.log("SAID", step, "bodies", globalThis.runsOfPart ?? 0, ...all, process.argv.length > 9);
test("t", async () => {
  try { say("import a.mjs", (await import("./a.mjs")).seen); } catch (error) { say("import a.mjs threw", error.message); }
  vi.doMock("./part.mjs", async original => { console.log("SAID g<"); return { ...(await original()), v: "mock" }; });
  try { say("import b.mjs", (await import("./b.mjs")).seen); } catch (error) { say("import b.mjs threw", error.message); }
});
