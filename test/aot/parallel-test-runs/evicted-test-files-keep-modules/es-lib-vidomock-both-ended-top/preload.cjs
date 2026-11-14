const { mock, vi } = require("bun:test");
vi.mock("./lib.mjs", () => ({ word: "preload", default: { word: "preload" } }));
