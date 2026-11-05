import { test, mock } from "bun:test";
const name: string = ["node:os", "node:path"][JSON.parse("1")];
mock.module("node:path", async () => ({ ...(await import(name)), basename: () => "mock name" }));
test("a", async () => { const path = await import("node:path"); console.log("a", path.basename("/x/y.txt"), path.extname("/x/y.txt"), typeof path.join); });
