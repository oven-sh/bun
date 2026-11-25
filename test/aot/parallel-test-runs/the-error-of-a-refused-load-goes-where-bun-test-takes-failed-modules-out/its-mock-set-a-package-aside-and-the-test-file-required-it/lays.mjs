import { mock } from "bun:test";
mock.module("bincjs", () => ({ o: "of the preload" }));
await import("bincjs");
