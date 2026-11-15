// The factory of a preload requires a file that requires the mocked file.
import { vi } from "bun:test";
globalThis.calls = 0;
globalThis.gate = Promise.withResolvers();
vi.mock("./part.cjs", async () => { globalThis.calls++; await globalThis.gate.promise; const it = require("./dep.cjs"); return { x: "mock over " + it.seen }; });
