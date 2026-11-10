import { test, mock, vi } from "bun:test";
const say = (...words) => console.log("SAID", ...words);
const tell = async (name, deed) => { try { say(name, JSON.stringify(await deed())); } catch (error) { say(name, "threw", String(error && error.message)); } };
let calls = 0;
mock.module("./early.mjs", async () => { calls++; await 0; return { word: "stand-in" }; });
mock.module("./late.mjs", async () => { calls++; await 0; return { word: "stand-in" }; });
test("cell", async () => {
  await tell("the export ahead of the throw", () => require("./early.mjs").word);
  await tell("again", () => require("./early.mjs").word);
  await tell("the export behind the throw", () => require("./late.mjs").word);
  await tell("again", () => require("./late.mjs").word);
  say("turns", globalThis.turnsOfEarly, globalThis.turnsOfLate, "calls", calls);
});
