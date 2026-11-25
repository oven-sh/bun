import { jest, mock } from "bun:test";
mock.module("./bin.cjs", () => ({ o: "of the preload" }));
await import("./bin.cjs");
