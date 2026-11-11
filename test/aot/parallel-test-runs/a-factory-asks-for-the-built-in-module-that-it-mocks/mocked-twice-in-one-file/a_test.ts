import { test, mock } from "bun:test";
mock.module("node:path", async () => ({ ...(await import("node:path")), basename: () => "mock name" }));
test("a", async () => { const path = await import("node:path"); console.log("a", path.basename("/x/y.txt"), path.extname("/x/y.txt")); });
test("b", async () => { mock.module("node:path", async () => ({ ...(await import("node:path")), extname: () => "mock end" })); const path = await import("node:path"); console.log("b", path.basename("/x/y.txt"), path.extname("/x/y.txt")); });
