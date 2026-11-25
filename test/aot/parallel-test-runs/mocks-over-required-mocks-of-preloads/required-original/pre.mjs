import { mock } from "bun:test";
mock.module("./dep.mjs", () => ({ x: "preload" }));
