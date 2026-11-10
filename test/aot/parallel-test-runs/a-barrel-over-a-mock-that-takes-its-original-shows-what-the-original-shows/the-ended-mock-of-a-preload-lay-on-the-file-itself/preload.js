import { vi } from "bun:test";
vi.doMock("./gauge.cjs", () => ({ spare: "of the ended mock" }));
await import("./porch.js");
vi.doUnmock("./gauge.cjs");
