import { vi } from "bun:test";
vi.doMock("./shapes.mjs", () => ({ painted: "mock" }));
await import("./early.mjs");
await import("./late.mjs");
vi.doUnmock("./shapes.mjs");
