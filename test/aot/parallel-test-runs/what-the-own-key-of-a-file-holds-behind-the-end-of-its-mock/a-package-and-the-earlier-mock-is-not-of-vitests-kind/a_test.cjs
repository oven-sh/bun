const { test, vi, mock, jest } = require("bun:test");
const key = require.resolve("pack/lib.cjs");
const fake = () => ({ exports: { a: "fake" } });
const ask = () => { try { return require("pack/lib.cjs"); } catch (error) { return { a: error.name }; } };
const say = (at, it, other) => console.log("SAID", globalThis.runsOfLib, at, it.a, it.n, it === other);
test("t", async () => {
  mock.module("pack/lib.cjs", async () => { await 0; return { a: "mocked", n: -1 }; });
  const first = ask(); say("beside", first, first);
  vi.doMock("pack/lib.cjs", () => ({ a: "later", n: -2 })); say("under the later", ask(), first);
  require.cache[key] = fake(); say("stored", ask(), first); delete require.cache[key];
  vi.doUnmock("pack/lib.cjs"); say("behind the end", ask(), first);
});
