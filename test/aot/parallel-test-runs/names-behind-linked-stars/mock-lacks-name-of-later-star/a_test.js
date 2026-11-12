import { test, vi } from "bun:test";
import "./inner.js";
test("a", async () => { vi.doMock("./other.js", () => ({ extra: 30 })); const user = await import("./user.js"); vi.doUnmock("./other.js"); console.log("SAID", user.look("kept", "both", "extra")); });
