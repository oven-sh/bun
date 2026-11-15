const { test, vi, mock, jest } = require("bun:test");
const kept = [];
const keep = async load => kept.push(await load());
const actual = () => vi.importActual("./lib.cjs"), required = () => jest.requireActual("./lib.cjs"), imported = () => import("./lib.cjs");
test("t", async () => {
  kept.push(require("./lib.cjs"));
  vi.doMock("./lib.cjs", () => ({ a: "mock", n: -1 }));
  await keep(actual);
  await keep(actual);
  console.log("SAID", kept.map(it => it.a + it.n).join(), kept.map(it => kept.indexOf(it)).join());
});
