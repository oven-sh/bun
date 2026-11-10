import { test, mock, vi } from "bun:test";
const say = (...words) => console.log("SAID", ...words);
const tell = async (name, deed) => { try { say(name, JSON.stringify(await deed())); } catch (error) { say(name, "threw", String(error && error.message)); } };
let calls = 0;
mock.module("./mends.mjs", async () => { calls++; await 0; return { word: "stand-in" }; });
mock.module("./stays.mjs", async () => { calls++; await 0; return { word: "stand-in" }; });
test("cell", async () => {
  await tell("a body that mends", () => require("./mends.mjs").word);
  await tell("a body that stays down", () => require("./stays.mjs").word);
  vi.resetModules();
  await tell("mends, behind the reset", () => require("./mends.mjs").word);
  await tell("again", () => require("./mends.mjs").word);
  await tell("stays down, behind the reset", () => require("./stays.mjs").word);
  await tell("again", () => require("./stays.mjs").word);
  say("turns", globalThis.turnsOfMends, globalThis.turnsOfStays, "calls", calls);
});
