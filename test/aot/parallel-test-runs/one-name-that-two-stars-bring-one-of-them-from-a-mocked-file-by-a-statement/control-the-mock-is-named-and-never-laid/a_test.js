import { test, vi, mock } from "bun:test";
const say = async (at, file) => { try { const it = await import(file); console.log("SAID", at, file, String(it.look()), it.keys?.()); } catch (e) { console.log("SAID", at, file, e.name); } };
test("t", async () => {
  if (globalThis.never) vi.doMock("./shapes.mjs", () => ({ spare: 2, round: 22 }));
  await say("no mock", "./named.mjs");
  await say("no mock", "./space.mjs");
});
