const { test, vi, mock, jest } = require("bun:test");
const key = require.resolve("./lib.cjs");
const fake = () => ({ exports: { a: "fake" } });
const ask = () => { try { return require("./lib.cjs"); } catch (error) { return { a: error.name }; } };
const say = (at, it, other) => console.log("SAID", globalThis.runsOfLib, at, it.a, it.n, it === other);
test("t", async () => {
  vi.doMock("./lib.cjs", async () => { await 0; return { a: "mocked", n: -1 }; });
  const first = ask(); say("beside", first, first);
  vi.doMock("./lib.cjs", () => ({ a: "later", n: -2 })); say("under the later", ask(), first);
  require.cache[key] = fake(); say("stored", ask(), first); delete require.cache[key];
  vi.doUnmock("./lib.cjs"); say("behind the end", ask(), first);
});
