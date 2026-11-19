import { test } from "bun:test";
test("one", async () => { const late = await import("./porch.js"); console.log("SAID", globalThis.runs ?? 0, Object.keys(late).sort().join()); });
