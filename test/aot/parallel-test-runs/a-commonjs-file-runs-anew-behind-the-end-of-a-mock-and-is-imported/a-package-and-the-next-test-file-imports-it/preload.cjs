const { mock } = require("bun:test");
mock.module('pack/lib.cjs', () => ({ a: "preload", n: -9 }));
