import { mock, vi } from "bun:test";
mock.module("node:path", () => ({ sep: "preload one" }));
globalThis.first = await import("./first.mjs");
mock.module("node:path", () => ({ sep: "preload two" }));
