const { mock } = require("bun:test");
mock.module("./tax", () => ({ rate: "mock rate" }));
