const { mock } = require("bun:test");
mock.module("pack/greeting.cjs", () => ({ word: "preload" }));
globalThis.heldByThePreload = require("pack/greeting.cjs");
