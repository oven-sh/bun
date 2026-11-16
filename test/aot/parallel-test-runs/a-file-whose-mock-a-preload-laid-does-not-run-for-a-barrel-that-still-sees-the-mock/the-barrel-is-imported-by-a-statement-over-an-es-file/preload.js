import { vi } from "bun:test";
vi.doMock("./gauge.mjs", () => ({ lent: "of the ended mock" }));
await import("./porch.js");
vi.doUnmock("./gauge.mjs");
