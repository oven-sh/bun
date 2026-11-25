import { vi, mock } from "bun:test";
mock.module("./part.cjs", () => ({ a: "of the preload" }));
globalThis.requiredByThePreload = require("./part.cjs");
