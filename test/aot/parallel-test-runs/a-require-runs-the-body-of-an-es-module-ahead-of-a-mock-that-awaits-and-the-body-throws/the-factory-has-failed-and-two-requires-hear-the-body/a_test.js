import { test, mock, vi } from "bun:test";
const say = (...words) => console.log("SAID", ...words);
const tell = async (name, deed) => { try { say(name, JSON.stringify(await deed())); } catch (error) { say(name, "threw", String(error && error.message)); } };
let calls = 0;
mock.module("./part.mjs", async () => { calls++; await 0; throw new Error("the factory fails"); });
test("cell", async () => {
  await tell("imported", async () => (await import("./part.mjs")).word);
  await tell("required", () => require("./part.mjs").word);
  await tell("required again", () => require("./part.mjs").word);
  say("turns", globalThis.turnsOfPart, "calls", calls);
});
