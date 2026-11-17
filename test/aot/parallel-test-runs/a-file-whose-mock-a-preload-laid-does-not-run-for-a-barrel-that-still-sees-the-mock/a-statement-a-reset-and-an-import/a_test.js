import { test, vi } from "bun:test";
import * as early from "./porch.js";
test("one", async () => { vi.resetModules(); const late = await import("./porch.js"); console.log("SAID", globalThis.runs ?? 0, Object.keys(early).sort().join(), Object.keys(late).sort().join()); });
