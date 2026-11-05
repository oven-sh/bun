import { test, mock } from "bun:test";
mock.module("node:path", async () => { const real = await import("node:path"); return { ...real, basename: (...a: [string]) => "mock " + real.basename(...a) }; });
test("a", async () => { const path = await import("node:path"); console.log("a", path.basename("/x/y.txt"), path.basename("/x/z.txt"), path.extname("/x/y.txt")); });
