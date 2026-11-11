const { mock } = require("bun:test");
const NAME = "./lib.mjs";
mock.module(NAME, () => ({ a: "preload", n: -9 }));
