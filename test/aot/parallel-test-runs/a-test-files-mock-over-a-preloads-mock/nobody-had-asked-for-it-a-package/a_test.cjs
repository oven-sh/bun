// As ../nobody-had-asked-for-the-preloads-mock.
const { test, vi, mock } = require("bun:test");
const ask = async () => { try { const it = require("made-up-lib"); return it.a + " " + it.n; } catch (error) { return error.name; } };
const say = (at, ...all) => console.log("SAID", at, globalThis.runsOfLib, ...all);
test("a", async () => {
  vi.doMock("made-up-lib", () => ({ a: "mine", n: -1 })); say("mocked", await ask());
  vi.doUnmock("made-up-lib"); say("ended", await ask(), await ask());
});
