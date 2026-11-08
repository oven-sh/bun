import { vi } from "bun:test";
vi.doMock("./gauge.mjs", () => ({ lent: 1 }));
await import("./porch.js");
vi.doUnmock("./gauge.mjs");
