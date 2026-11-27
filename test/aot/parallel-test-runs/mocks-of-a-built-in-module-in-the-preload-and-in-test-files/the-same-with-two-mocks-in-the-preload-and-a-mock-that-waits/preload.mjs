import { mock, vi } from "bun:test";
vi.doMock("node:path", () => ({ sep: "preload one" }));
globalThis.first = await import("./first.mjs");
vi.doMock("node:path", () => ({ sep: "preload two" }));
