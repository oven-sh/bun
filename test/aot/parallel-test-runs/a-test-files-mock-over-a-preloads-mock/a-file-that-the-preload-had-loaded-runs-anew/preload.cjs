const { mock } = require("bun:test");
globalThis.first = require('./lib.cjs');
mock.module('./lib.cjs', () => ({ a: "preload", n: -9 }));
