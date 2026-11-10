import { test, vi } from "bun:test";
test("one", async () => { vi.doMock("./gauge.cjs", () => ({ lent: 1 })); await import("./porch.js"); vi.doUnmock("./gauge.cjs"); console.log("SAID behind the end", globalThis.runs ?? 0); const late = await import("./porch.js"); console.log("SAID", globalThis.runs ?? 0, Object.keys(late).sort().join()); });
