import { mock } from "bun:test";
mock.module("./g.cjs", () => ({ word: "preload" }));
