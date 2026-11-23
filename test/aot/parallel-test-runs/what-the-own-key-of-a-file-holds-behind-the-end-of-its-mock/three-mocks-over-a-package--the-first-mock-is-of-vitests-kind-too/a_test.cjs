const { test, vi, mock, jest } = require("bun:test");
const key = require.resolve("pack/lib.cjs");
const ask = () => { try { return require("pack/lib.cjs"); } catch (error) { return { a: error.name }; } };
const say = (at, it, other) => console.log("SAID", globalThis.runsOfLib, at, it.a, it.n, it === other);
test("t", async () => {
  vi.doMock("pack/lib.cjs", async () => { await 0; return { a: "mocked", n: -1 }; });
  const first = ask(); say("beside", first, first);
  delete require.cache[key];
  vi.doMock("pack/lib.cjs", () => ({ a: "later", n: -2 }));
  mock.module("pack/lib.cjs", () => ({ a: "third", n: -3 }));
  vi.doUnmock("pack/lib.cjs"); say("behind the end", ask(), first);
});
