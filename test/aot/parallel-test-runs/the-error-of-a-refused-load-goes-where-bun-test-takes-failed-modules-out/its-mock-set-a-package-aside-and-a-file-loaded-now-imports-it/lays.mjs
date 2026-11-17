import { mock } from "bun:test";
mock.module("bines", () => ({ o: "of the preload" }));
await import("bines");
