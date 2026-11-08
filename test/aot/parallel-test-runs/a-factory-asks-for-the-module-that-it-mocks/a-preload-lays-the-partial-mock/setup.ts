import { mock } from "bun:test";
mock.module("./tax", async () => ({ ...(await import("./tax")), rate: "mock rate" }));
