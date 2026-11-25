import { vi } from "bun:test";
globalThis.late = Promise.withResolvers(); globalThis.calls = 0;
vi.mock("./part.js", () => { globalThis.calls++; return globalThis.late.promise; });
