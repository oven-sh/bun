const { jest, mock, vi } = require("bun:test");
{
  jest.mock("./tax.mjs", () => ({ rate: "mock" }));
  jest.mock("./tax.cjs", () => ({ rate: "mock" }));
  jest.mock("node:os", () => ({ rate: "mock" }));
  jest.mock("@made-up/absent", () => ({ rate: "mock" }));
}
