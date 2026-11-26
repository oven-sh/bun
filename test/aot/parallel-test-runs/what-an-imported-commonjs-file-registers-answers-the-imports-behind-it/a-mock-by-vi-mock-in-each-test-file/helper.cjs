const { jest, mock, vi } = require("bun:test");
{
  vi.mock("./tax.mjs", () => ({ rate: "mock" }));
  vi.mock("./tax.cjs", () => ({ rate: "mock" }));
  vi.mock("node:os", () => ({ rate: "mock" }));
  vi.mock("@made-up/absent", () => ({ rate: "mock" }));
}
