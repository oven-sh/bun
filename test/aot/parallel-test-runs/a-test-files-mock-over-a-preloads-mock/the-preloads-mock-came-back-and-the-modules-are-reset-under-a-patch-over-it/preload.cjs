const { mock } = require("bun:test");
const NAME = "./lib.cjs";
mock.module(NAME, () => ({ a: "preload", n: -9 }));
