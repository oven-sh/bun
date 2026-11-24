// The preload has loaded the package and patched it. The test file lays its own mock over that, stores a module of its own under the key and deletes it. A package is one instance: where the next test file ends the preload's patch, what the preload had loaded is back, and the file does not run again.
const { test, vi, mock } = require("bun:test");
const key = require.resolve("made-up-lib");
const ask = () => { try { const it = require("made-up-lib"); return it && it.a + " " + it.n; } catch (error) { return error.name; } };
const fake = () => ({ exports: { a: "fake", n: 0 } });
const say = (at, ...all) => console.log("SAID", at, globalThis.runsOfLib, ...all);
test("a", () => {
  say("a", ask());
  vi.doMock("made-up-lib", () => ({ a: "mine", n: -1 })); require.cache[key] = fake(); delete require.cache[key]; say("deleted", ask());
});
