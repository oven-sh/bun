// As ../a-package-and-the-mock-is-taken-off, of an ES module.
import { test, vi, mock } from "bun:test";
const ask = async () => { try { const it = await import("made-up-lib"); return it.a + " " + it.n; } catch (error) { return error.name; } };
const say = (at, ...all) => console.log("SAID", at, globalThis.runsOfLib, ...all);
test("a", async () => {
  say("a", await ask());
  vi.doMock("made-up-lib", () => ({ a: "mine", n: -1 })); say("mocked", await ask());
  vi.doUnmock("made-up-lib"); say("ended", await ask(), await ask());
});
