import { mock } from "bun:test";
mock.module("./greeting.cjs", () => ({ word: "preload" }));
