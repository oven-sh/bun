import { mock } from "bun:test";
mock.module("node:path", () => ({ sep: "preload" }));
