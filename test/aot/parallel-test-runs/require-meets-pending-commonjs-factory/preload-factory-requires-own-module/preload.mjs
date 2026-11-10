// The factory of a preload requires its own CommonJS file behind an await.
import { vi } from "bun:test";
globalThis.calls = 0;
globalThis.gate = Promise.withResolvers();
vi.mock("./part.cjs", async () => { globalThis.calls++; await globalThis.gate.promise; const it = require("./part.cjs"); return { x: "mock over " + it.x }; });
