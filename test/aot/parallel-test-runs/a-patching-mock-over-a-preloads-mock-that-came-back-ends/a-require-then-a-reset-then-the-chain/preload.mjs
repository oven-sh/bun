import { mock } from "bun:test";
mock.module("./greeting.cjs", () => { globalThis.factories = (globalThis.factories ?? 0) + 1; return { word: "preload" }; });
