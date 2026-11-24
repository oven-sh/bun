const { test, vi } = require("bun:test");
test("a", () => {
  const lamp = require("lamp");
  console.log(lamp.seen().width, require("./wick.cjs").bodies);
  vi.doMock("./wick.cjs", () => ({ width: "mocked", bodies: -1 }));
  console.log(lamp.seen().width, lamp.seen().bodies, globalThis.bodies);
});
