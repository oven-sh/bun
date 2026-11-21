import { test, vi, mock, jest } from "bun:test";
import "./inner.js";
test("a", async () => { vi.doMock("./other.cjs", () => ({ extra: 30 })); const user = await import("./user.js"); vi.doUnmock("./other.cjs"); console.log("SAID", user.look("kept", "both", "extra"), globalThis.ran); });
