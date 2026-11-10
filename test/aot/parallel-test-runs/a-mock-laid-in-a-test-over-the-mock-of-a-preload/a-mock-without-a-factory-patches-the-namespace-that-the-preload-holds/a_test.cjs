const { jest, test } = require("bun:test");
test("what the preload holds is patched in place", () => {
  const before = globalThis.heldByThePreload.a;
  jest.doMock("./lib.cjs");
  console.log("SAID", before, globalThis.heldByThePreload.a);
});
