import { test, vi, mock } from "bun:test";
test("a", async () => {
  const kept = (globalThis.kept ??= []);
  const say = at => console.log("SAID", "a", at, globalThis.runs, ...kept.map(it => it.read()));
  const fresh = async () => { try { const it = await import("./reader.mjs"); if (!kept.includes(it)) kept.push(it); } catch (error) { console.log("SAID", error.name); } };
  await fresh(); say("front");
  vi.doMock("./leaf.cjs", () => ({ word: "mock", default: { word: "mock" } }));
  say("laid"); await fresh(); say("under");
  vi.doUnmock("./leaf.cjs");
  say("ended"); await fresh(); say("behind");
});
