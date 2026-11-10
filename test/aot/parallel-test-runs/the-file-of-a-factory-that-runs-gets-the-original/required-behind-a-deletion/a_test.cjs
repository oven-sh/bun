// mock.module() over a file that has run calls the factory at once. While its promise is pending, the file in which the factory is written gets the original, under a key of its own.
// So a require() behind `delete require.cache[key]` answers the original, and does not throw that it cannot wait for the factory.
const { test, mock } = require("bun:test");
const key = require.resolve("./lib.cjs");
let first;
const ask = () => { try { return require("./lib.cjs"); } catch (error) { return { a: error.name }; } };
const say = (at, it) => console.log("SAID", at, it.a, it.n, it === first, globalThis.runsOfLib);
test("t", async () => {
  first = ask(); say("in front", first);
  mock.module("./lib.cjs", async () => { await 0; return { a: "mocked", n: -1 }; });
  delete require.cache[key]; say("behind the deletion", ask()); say("once more", ask());
  await new Promise(resolve => setTimeout(resolve, 5)); say("settled", ask());
});
