import { test, vi } from "bun:test";
test("a", async () => { vi.doMock("./part.cjs", () => ({ default: 1, kept: 10, both: "m" })); await import("./asks.js"); const user = await import("./user.js"); vi.doUnmock("./part.cjs"); console.log("SAID", user.look("kept", "both"), globalThis.ran); });
