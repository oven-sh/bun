const { vi } = require("bun:test");
vi.mock("./tax", () => ({ rate: "mock rate" }));
