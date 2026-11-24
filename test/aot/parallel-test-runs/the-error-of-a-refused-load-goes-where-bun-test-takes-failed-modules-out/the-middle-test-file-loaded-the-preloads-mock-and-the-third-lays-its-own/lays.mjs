import { mock } from "bun:test";
mock.module("./bin.mjs", () => ({ o: "of the preload" }));
