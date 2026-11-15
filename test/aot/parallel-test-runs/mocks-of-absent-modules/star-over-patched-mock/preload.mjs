import { mock } from "bun:test";
mock.module("./absent.mjs", () => ({ get: () => "mock of the preload", extra: 1 }));
