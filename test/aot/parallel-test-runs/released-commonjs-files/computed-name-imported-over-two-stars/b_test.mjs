import { test, vi, mock } from "bun:test";
test("b", async () => {
  const kept = (globalThis.kept ??= []);
  const say = at => console.log("SAID", "b", at, globalThis.runs, ...kept.map(it => it.read() + "|" + it.held.word));
  const fresh = async () => { try { const it = await import("./reader.mjs"); if (!kept.includes(it)) kept.push(it); } catch (error) { console.log("SAID", error.name); } };
  await fresh(); say("front");
  mock.module("./leaf.cjs", () => ({ word: "patch", say: () => "patch" }));
  say("laid"); await fresh(); say("under");
  vi.doUnmock("./leaf.cjs");
  say("ended"); await fresh(); say("behind");
});
