const { test, vi, mock, jest } = require("bun:test");
const kept = [];
const actual = async () => kept.push(await vi.importActual("./lib.cjs"));
test("a", async () => {
  kept.push(require("./lib.cjs"));
  mock.module("./lib.cjs", () => ({ a: "mock", n: -1 }));
  await actual();
  await actual();
  console.log("SAID", kept.map(it => it.a + it.n).join(), kept.map(it => kept.indexOf(it)).join());
});
