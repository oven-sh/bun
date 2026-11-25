import { mock } from "bun:test";
mock.module("./middle.mjs", () => ({ name: "mock" }));
