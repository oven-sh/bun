import { mock } from "bun:test";
mock.module("./dep", () => ({ value: () => "mock b" }));
