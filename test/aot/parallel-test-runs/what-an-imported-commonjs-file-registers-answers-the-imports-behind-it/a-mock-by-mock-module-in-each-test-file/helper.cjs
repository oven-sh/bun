const { jest, mock, vi } = require("bun:test");
{
  mock.module("./tax.mjs", () => ({ rate: "mock" }));
  mock.module("./tax.cjs", () => ({ rate: "mock" }));
  mock.module("node:os", () => ({ rate: "mock" }));
  mock.module("@made-up/absent", () => ({ rate: "mock" }));
}
