const { test, vi } = require("bun:test");
const ask = () => { const it = require("./lib.cjs"); return it.a + " " + it.n; };
test("a", () => {
  console.log("SAID a", ask());
  vi.doMock("./lib.cjs", () => ({ a: "mine", n: -1 }));
  console.log("SAID a mocked", ask());
  vi.doUnmock("./lib.cjs");
  console.log("SAID a ended", ask());
});
