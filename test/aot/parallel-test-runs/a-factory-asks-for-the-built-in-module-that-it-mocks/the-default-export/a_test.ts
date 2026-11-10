import { test, mock } from "bun:test";
mock.module("node:path", async () => ({ ...(await import("node:path")), basename: () => "mock name" }));
test("a", async () => { const path = await import("node:path"); console.log("a", path.basename("/x/y.txt"), path.default.basename("/x/y.txt"), typeof path.default.join, path.default === (path as any)); });
