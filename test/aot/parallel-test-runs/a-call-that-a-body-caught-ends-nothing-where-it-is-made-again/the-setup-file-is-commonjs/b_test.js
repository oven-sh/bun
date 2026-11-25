import { test } from "bun:test";
const say = (...words) => console.log("SAID", ...words);
const tell = async (name, deed) => { try { say(name, JSON.stringify(await deed())); } catch (error) { say(name, "threw", String(error && error.message)); } };
test("two", async () => {
  say("file", "two");
  await tell("setup", async () => { await import("./setup.cjs"); return "loaded"; });
  await tell("lamp", async () => (await import("./lamp.mjs")).word);
  await tell("desk", async () => (await import("./desk.mjs")).word);
  await tell("rug", async () => (await import("./rug.mjs")).word);
});
