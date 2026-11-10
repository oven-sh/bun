import { test, vi } from "bun:test";
test("one", async () => { const under = await import("./porch.js"); console.log("SAID under", globalThis.runs ?? 0, Object.keys(under).sort().join()); vi.doUnmock("./gauge.cjs"); const late = await import("./porch.js"); console.log("SAID behind", globalThis.runs ?? 0, Object.keys(late).sort().join(), Object.keys(under).sort().join()); });
