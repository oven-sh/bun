import { mock } from "bun:test";
mock.module("node:path", async () => ({ ...(await import("node:path")), basename: () => "mock name" }));
