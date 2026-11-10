import { mock } from "bun:test";
await import("./bin.mjs");
mock.module("./bin.mjs", () => ({ o: "of the preload" }));
