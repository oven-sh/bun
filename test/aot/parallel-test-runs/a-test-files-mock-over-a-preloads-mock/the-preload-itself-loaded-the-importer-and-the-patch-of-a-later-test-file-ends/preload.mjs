import { mock } from "bun:test";
mock.module("./gear.cjs", () => ({ word: "preload" }));
await import("./early.mjs");
