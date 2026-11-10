import { vi } from "bun:test";
vi.doMock("./shapes.mjs", () => ({ painted: "mock" }));
await import("./early.mjs");
vi.doUnmock("./shapes.mjs");
