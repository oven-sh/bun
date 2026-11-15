const { test, vi, mock, jest } = require("bun:test");
const kept = [];
const keep = async load => kept.push(await load());
const actual = () => vi.importActual("./lib.cjs"), required = () => jest.requireActual("./lib.cjs"), imported = () => import("./lib.cjs");
test("t", async () => {
  vi.doMock("./lib.cjs", async original => ({ ...(await original()), b: 1 }));
  await keep(imported);
  await keep(actual);
  console.log("SAID", kept.map(it => it.a + it.n).join(), kept.map(it => kept.indexOf(it)).join());
});
