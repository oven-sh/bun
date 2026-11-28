const { jest, mock, vi } = require("bun:test");
{
  vi.doMock("./tax.mjs", () => ({ rate: "mock" }));
  vi.doMock("./tax.cjs", () => ({ rate: "mock" }));
  vi.doMock("node:os", () => ({ rate: "mock" }));
  vi.doMock("@made-up/absent", () => ({ rate: "mock" }));
}
