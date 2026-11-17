const { mock, vi } = require("bun:test");
const NAME = "pack/lib.cjs";
mock.module(NAME, () => ({ a: "preload", n: -9 }));
