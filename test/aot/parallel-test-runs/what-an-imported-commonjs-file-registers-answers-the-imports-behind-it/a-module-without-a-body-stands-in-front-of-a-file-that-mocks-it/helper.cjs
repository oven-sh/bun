const { mock, vi } = require("bun:test");
{
  vi.doMock("./lib.mjs", () => ({ used: () => "mock" }));
}
