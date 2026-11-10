const { test, vi, mock, jest } = require("bun:test");
const ask = () => { try { return require("pack/lib.cjs"); } catch (error) { return { a: error.name }; } };
const say = (at, it, other) => console.log("SAID", globalThis.runsOfLib, at, it?.a, it?.n, it === other);
const late = async () => { await 0; return { a: "mocked", n: process.argv.length > 9 ? 0 : -1 }; };
const last = () => ({ a: "last", n: -3 });
test("t", async () => {
  vi.doMock("pack/lib.cjs", late);
  const first = ask(); say("beside", first, first);
  vi.doUnmock("pack/lib.cjs");
  say("behind the end", ask(), first); say("and once more", ask(), first);
});
