// The helper lays the partial mock, and two test files import the helper.
import { mock } from "bun:test";
mock.module("./tax", async () => ({ ...(await import("./tax")), rate: "mock rate" }));
