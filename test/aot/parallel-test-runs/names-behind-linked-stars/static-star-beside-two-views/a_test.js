import { test, vi } from "bun:test";
import "./a.js";
test("a", async () => { vi.doMock("./part.cjs", () => ({ default: 1, kept: 10 })); await import("./asks.js"); const user = await import("./user.js"); vi.doUnmock("./part.cjs"); console.log("SAID", user.look("kept", "both")); });
