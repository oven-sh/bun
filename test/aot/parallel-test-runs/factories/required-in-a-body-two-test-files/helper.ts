import { mock } from "bun:test";
mock.module("./tax", () => ({ rate: "mock rate" }));
