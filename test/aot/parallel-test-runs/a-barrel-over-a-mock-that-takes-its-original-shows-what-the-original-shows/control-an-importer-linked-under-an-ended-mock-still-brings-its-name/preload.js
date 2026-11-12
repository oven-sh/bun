import { vi } from "bun:test";
vi.doMock("./gauge.mjs", () => ({ lent: "mock" }));
await import("./porch.js");
vi.doUnmock("./gauge.mjs");
