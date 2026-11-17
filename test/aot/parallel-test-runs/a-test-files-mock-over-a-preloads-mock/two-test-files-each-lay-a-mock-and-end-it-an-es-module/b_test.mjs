import { test, vi, mock } from "bun:test";
const ask = async () => { try { const it = await import("./lib.mjs"); return it.a + " " + it.n; } catch (error) { return error.name; } };
const say = (at, ...all) => console.log("SAID", at, globalThis.runsOfLib, ...all);
test("b", async () => {
  say("a", await ask());
  vi.doMock("./lib.mjs", () => ({ a: "mine", n: -1 })); say("mocked", await ask());
  vi.doUnmock("./lib.mjs"); say("ended", await ask(), await ask());
});
