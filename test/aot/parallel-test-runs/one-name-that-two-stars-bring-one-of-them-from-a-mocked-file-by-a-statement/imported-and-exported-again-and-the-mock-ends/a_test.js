import { test, vi, mock } from "bun:test";
const say = async (at, file) => { try { const it = await import(file); console.log("SAID", at, file, String(it.look()), it.keys?.()); } catch (e) { console.log("SAID", at, file, e.name); } };
test("t", async () => {
  vi.doMock("./shapes.mjs", () => ({ spare: 2, round: 22 }));
  await say("under", "./named.mjs");
  await say("under", "./space.mjs");
  vi.doUnmock("./shapes.mjs");
  await say("behind", "./named.mjs");
  await say("behind", "./space.mjs");
  await say("behind, fresh", "./named2.mjs");
  await say("behind, fresh", "./space2.mjs");
});
