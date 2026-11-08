import { test, mock } from "bun:test";
mock.module("node:path", async () => { await Promise.resolve(); await new Promise(r => setTimeout(r, 1)); const original = await import("node:path"); return { ...original, basename: () => "mock name" }; });
test("a", async () => { const path = await import("node:path"); console.log("a", path.basename("/x/y.txt"), path.extname("/x/y.txt")); });
