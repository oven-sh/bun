import { mock } from "bun:test";
mock.module("./part.cjs", () => ({ a: "mocked" }));
globalThis.requiredByThePreload = require("./part.cjs");
globalThis.listedInThePreload = require.resolve("./part.cjs") in require.cache;
