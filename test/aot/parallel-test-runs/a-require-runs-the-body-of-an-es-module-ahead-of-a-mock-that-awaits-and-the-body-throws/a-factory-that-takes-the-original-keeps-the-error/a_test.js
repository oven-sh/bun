import { test, mock, vi } from "bun:test";
const say = (...words) => console.log("SAID", ...words);
const tell = async (name, deed) => { try { say(name, JSON.stringify(await deed())); } catch (error) { say(name, "threw", String(error && error.message)); } };
mock.module("./part.mjs", async original => { await 0; return { word: "stand-in" }; });
test("cell", async () => {
  await tell("required", () => require("./part.mjs").word);
  await tell("imported", async () => (await import("./part.mjs")).word);
  await tell("imported again", async () => (await import("./part.mjs")).word);
  await tell("required again", () => require("./part.mjs").word);
  say("turns", globalThis.turnsOfPart);
});
