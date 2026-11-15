const { test, vi } = require("bun:test");
test("t", () => {
  vi.doMock("./w.cjs", () => ({ ofW: 20 }));
  const top = require("./m0.mjs");
  console.log("SAID", top.ofZ, top.ofW);
});
