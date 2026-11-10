import { mock } from "bun:test";
mock.module("./other.mjs", () => ({ o: "preload other" }));
await import("./other.mjs");
