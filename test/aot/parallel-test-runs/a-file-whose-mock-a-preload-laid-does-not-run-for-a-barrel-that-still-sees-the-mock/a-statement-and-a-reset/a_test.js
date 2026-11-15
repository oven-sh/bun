import { test, vi } from "bun:test";
import * as early from "./porch.js";
test("one", () => { vi.resetModules(); console.log("SAID", globalThis.runs ?? 0, Object.keys(early).sort().join()); });
