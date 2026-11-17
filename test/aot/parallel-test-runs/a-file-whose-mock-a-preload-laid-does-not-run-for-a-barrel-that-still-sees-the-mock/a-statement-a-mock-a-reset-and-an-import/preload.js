import { vi } from "bun:test";
vi.doMock("./gauge.cjs", () => ({ lent: "of the ended mock" }));
await import("./porch.js");
vi.doUnmock("./gauge.cjs");
