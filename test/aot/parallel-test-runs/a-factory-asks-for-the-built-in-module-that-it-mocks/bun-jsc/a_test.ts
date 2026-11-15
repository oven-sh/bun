import { test, mock } from "bun:test";
mock.module("bun:jsc", async () => ({ ...(await import("bun:jsc")), heapSize: () => "mock size" }));
test("a", async () => { const jsc = await import("bun:jsc"); console.log("a", jsc.heapSize(), typeof jsc.gcAndSweep); });
