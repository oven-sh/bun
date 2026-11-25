import { test, vi } from "bun:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const say = (...all) => console.log("SAID", globalThis.runs, ...all);
test("t", async () => {
  vi.doMock("./leaf.cjs", async () => { await 0; return { word: "late" }; });
  try { say("under", require("./star.mjs").word); } catch (error) { say(error.name); }
  vi.doUnmock("./leaf.cjs");
  say("ended", (await import("./star.mjs")).word);
  try { say("ended", require("./middle.cjs").word()); } catch (error) { say(error.name); }
});
