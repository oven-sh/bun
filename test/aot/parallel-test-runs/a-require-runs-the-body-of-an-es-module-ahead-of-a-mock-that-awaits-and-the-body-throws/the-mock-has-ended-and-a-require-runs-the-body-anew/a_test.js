import { test, mock, vi } from "bun:test";
const say = (...words) => console.log("SAID", ...words);
const tell = async (name, deed) => { try { say(name, JSON.stringify(await deed())); } catch (error) { say(name, "threw", String(error && error.message)); } };
let calls = 0;
test("cell", async () => {
  vi.doMock("./mends.mjs", async () => { calls++; try { require("./mends.mjs"); } catch {} await 0; return { word: "stand-in" }; });
  vi.doMock("./stays.mjs", async () => { calls++; try { require("./stays.mjs"); } catch {} await 0; return { word: "stand-in" }; });
  await tell("a body that mends, imported", async () => (await import("./mends.mjs")).word);
  await tell("a body that stays down, imported", async () => (await import("./stays.mjs")).word);
  globalThis.mended = true;
  vi.doUnmock("./mends.mjs");
  vi.doUnmock("./stays.mjs");
  await tell("mends, required behind the end", () => require("./mends.mjs").word);
  await tell("again", () => require("./mends.mjs").word);
  await tell("stays down, required behind the end", () => require("./stays.mjs").word);
  await tell("again", () => require("./stays.mjs").word);
  say("turns", globalThis.turnsOfMends, globalThis.turnsOfStays, "calls", calls);
});
