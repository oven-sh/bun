import { mock } from "bun:test";
mock.module("./absent.mjs", () => ({ word: "mock of the preload" }));
