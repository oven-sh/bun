import { test, vi } from "bun:test";
test("one", async () => { vi.doUnmock("./gauge.mjs"); const late = await import("./porch.js"); console.log("SAID behind", globalThis.runs ?? 0, Object.keys(late).sort().join()); });
