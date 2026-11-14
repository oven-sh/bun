import { vi } from "bun:test";
globalThis.calls = 0; globalThis.late = Promise.withResolvers();
vi.mock("./part.js", () => { globalThis.calls++; return globalThis.late.promise; });
