const { mock, vi } = require("bun:test");
const NAME = "./lib.cjs";
mock.module(NAME, () => ({ a: "preload", n: -9 }));
globalThis.heldByThePreload = require(NAME);
