// A helper lays the mock for two test files.
import { mock } from "bun:test";
mock.module("./tax", async () => { const reader = await import("./reader"); return { rate: "mock over " + reader.read() }; });
