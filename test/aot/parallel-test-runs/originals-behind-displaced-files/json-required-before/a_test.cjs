const { test, vi, mock, jest } = require("bun:test");
const kept = [];
const keep = async load => kept.push(await load());
const actual = () => vi.importActual("./lib.json"), required = () => jest.requireActual("./lib.json"), imported = () => import("./lib.json");
test("t", async () => {
  kept.push(require("./lib.json"));
  mock.module("./lib.json", () => ({ a: "mock", n: -1 }));
  await keep(actual);
  await keep(actual);
  console.log("SAID", kept.map(it => it.a + it.n).join(), kept.map(it => kept.indexOf(it)).join());
});
