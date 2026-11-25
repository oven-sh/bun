import { test } from "bun:test";
test("a", async () => { const path = await import("node:path"); console.log("a", path.basename("/x/y.txt"), path.extname("/x/y.txt"), typeof path.join); });
