import { test, vi, mock } from "bun:test";
const say = async (at, file) => { try { const it = await import(file); console.log("SAID", at, file, String(it.look()), it.keys?.()); } catch (e) { console.log("SAID", at, file, e.name); } };
test("t", async () => {
  mock.module("./shapes.mjs", () => ({ spare: 2, round: 22 }));
  await say("under", "./named.mjs");
  await say("under", "./space.mjs");
});
