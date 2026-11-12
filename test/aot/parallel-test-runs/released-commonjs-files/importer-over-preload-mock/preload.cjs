const { mock, vi } = require("bun:test");
vi.mock("./gauge.cjs", () => ({ word: "preload", default: { word: "preload" } }));
