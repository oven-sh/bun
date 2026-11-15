import { test } from "bun:test";
const say = async (at, file) => { try { const it = await import(file); console.log("SAID", at, file, String(it.look()), it.keys?.()); } catch (e) { console.log("SAID", at, file, e.name); } };
test("next", async () => {
  await say("next file", "./named.mjs");
  await say("next file", "./space.mjs");
});
