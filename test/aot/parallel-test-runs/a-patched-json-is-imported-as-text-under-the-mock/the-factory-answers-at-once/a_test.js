import { test, mock } from "bun:test";
const say = (...words) => console.log("SAID", ...words);
const tell = async (name, deed) => { try { say(name, JSON.stringify(await deed())); } catch (error) { say(name, "threw", String(error && error.message)); } };
import sheet from "./sheet.json";
test("cell", async () => {
  say("first", sheet.word);
  await tell("laid", async () => { await mock.module("./sheet.json", () => ({ default: { word: "stand-in" } })); return "laid"; });
  await tell("under as text", async () => (await import("./sheet.json", { with: { type: "text" } })).default);
  await tell("under as text again", async () => (await import("./sheet.json", { with: { type: "text" } })).default);
  await tell("under by a statement", async () => (await import("./late-under.mjs")).read());
  await tell("under as itself", async () => (await import("./sheet.json")).default);
});
